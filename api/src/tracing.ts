import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { trace, context, SpanStatusCode, SpanKind } from '@opentelemetry/api';
import { Request, Response, NextFunction } from 'express';
import { logger } from './logger';

const serviceName = process.env.SERVICE_NAME || 'shieldeye-api';
const serviceVersion = process.env.SERVICE_VERSION || '1.0.0';
const jaegerEndpoint = process.env.JAEGER_ENDPOINT || 'http://localhost:14268/api/traces';

const jaegerExporter = new JaegerExporter({
  endpoint: jaegerEndpoint,
});

const prometheusExporter = new PrometheusExporter({
  port: 9464,
}, () => {
  logger.info('Prometheus metrics server started on port 9464');
});

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
    [SemanticResourceAttributes.SERVICE_VERSION]: serviceVersion,
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
  }),
  traceExporter: jaegerExporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': {
        enabled: false,
      },
      '@opentelemetry/instrumentation-http': {
        enabled: true,
        requestHook: (span: any, request: any) => {
          span.setAttributes({
            'http.request.header.user-agent': request.getHeader('user-agent'),
            'http.request.header.x-forwarded-for': request.getHeader('x-forwarded-for'),
          });
        },
        responseHook: (span: any, response: any) => {
          span.setAttributes({
            'http.response.header.content-type': response.getHeader('content-type'),
          });
        },
      },
      '@opentelemetry/instrumentation-express': {
        enabled: true,
      },
      '@opentelemetry/instrumentation-pg': {
        enabled: true,
      },
      '@opentelemetry/instrumentation-redis': {
        enabled: true,
      },
    }),
  ],
});

export const initializeTracing = () => {
  try {
    sdk.start();
    logger.info('OpenTelemetry tracing initialized successfully', {
      serviceName,
      serviceVersion,
      jaegerEndpoint
    });
  } catch (error) {
    logger.error('Failed to initialize OpenTelemetry tracing', { error: error instanceof Error ? error.message : String(error) });
  }
};

export const shutdownTracing = async () => {
  try {
    await sdk.shutdown();
    logger.info('OpenTelemetry tracing shut down successfully');
  } catch (error) {
    logger.error('Failed to shutdown OpenTelemetry tracing', { error: error instanceof Error ? error.message : String(error) });
  }
};

export const tracer = trace.getTracer(serviceName, serviceVersion);

export const tracingMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const span = tracer.startSpan(`${req.method} ${req.route?.path || req.path}`, {
    kind: SpanKind.SERVER,
    attributes: {
      'http.method': req.method,
      'http.url': req.url,
      'http.route': req.route?.path || req.path,
      'http.user_agent': req.get('user-agent'),
      'http.request_id': req.id,
    },
  });

  req.span = span;
  req.traceId = span.spanContext().traceId;

  res.setHeader('X-Trace-Id', req.traceId || '');

  res.on('finish', () => {
    span.setAttributes({
      'http.status_code': res.statusCode,
      'http.response.size': res.get('content-length') || 0,
    });

    if (res.statusCode >= 400) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: `HTTP ${res.statusCode}`,
      });
    }

    span.end();
  });

  context.with(trace.setSpan(context.active(), span), () => {
    next();
  });
};

export const createSpan = (name: string, attributes?: Record<string, any>) => {
  return tracer.startSpan(name, {
    attributes,
  });
};

export const withSpan = async <T>(
  name: string,
  fn: (span: any) => Promise<T>,
  attributes?: Record<string, any>
): Promise<T> => {
  const span = tracer.startSpan(name, { attributes });
  
  try {
    const result = await context.with(trace.setSpan(context.active(), span), () => fn(span));
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    span.recordException(error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    span.end();
  }
};

export const traceDatabaseOperation = async <T>(
  operation: string,
  query: string,
  fn: () => Promise<T>
): Promise<T> => {
  return withSpan(
    `db.${operation}`,
    async (span) => {
      span.setAttributes({
        'db.system': 'postgresql',
        'db.operation': operation,
        'db.statement': query.substring(0, 1000), // Limit query length
      });
      return await fn();
    }
  );
};

export const traceQueueOperation = async <T>(
  operation: string,
  queueName: string,
  jobId?: string,
  fn?: () => Promise<T>
): Promise<T | void> => {
  const spanName = `queue.${operation}`;
  const attributes: Record<string, any> = {
    'messaging.system': 'redis',
    'messaging.destination': queueName,
    'messaging.operation': operation,
  };

  if (jobId) {
    attributes['messaging.message_id'] = jobId;
  }

  if (fn) {
    return withSpan(spanName, fn, attributes);
  } else {
    const span = createSpan(spanName, attributes);
    span.end();
  }
};

export const traceAIAnalysis = async <T>(
  analysisType: string,
  scanId: string,
  fn: () => Promise<T>
): Promise<T> => {
  return withSpan(
    `ai.analysis.${analysisType}`,
    async (span) => {
      span.setAttributes({
        'ai.analysis.type': analysisType,
        'scan.id': scanId,
        'ai.model': 'threat-intelligence-v1',
      });
      return await fn();
    }
  );
};

export const traceBlockchainVerification = async <T>(
  verificationType: string,
  packageName: string,
  fn: () => Promise<T>
): Promise<T> => {
  return withSpan(
    `blockchain.verification.${verificationType}`,
    async (span) => {
      span.setAttributes({
        'blockchain.verification.type': verificationType,
        'package.name': packageName,
        'blockchain.network': 'ethereum',
      });
      return await fn();
    }
  );
};

export const traceExternalAPI = async <T>(
  serviceName: string,
  endpoint: string,
  method: string,
  fn: () => Promise<T>
): Promise<T> => {
  return withSpan(
    `external.${serviceName}`,
    async (span) => {
      span.setAttributes({
        'http.method': method,
        'http.url': endpoint,
        'external.service': serviceName,
      });
      return await fn();
    }
  );
};

export const recordError = (error: Error, additionalAttributes?: Record<string, any>) => {
  const span = trace.getActiveSpan();
  if (span) {
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
    
    if (additionalAttributes) {
      span.setAttributes(additionalAttributes);
    }
  }
};

export const recordCustomMetric = (name: string, value: number, attributes?: Record<string, any>) => {
  const span = trace.getActiveSpan();
  if (span && attributes) {
    span.setAttributes({
      [`metric.${name}`]: value,
      ...attributes,
    });
  }
};

declare global {
  namespace Express {
    interface Request {
      span?: any;
      traceId?: string;
    }
  }
}
