import winston from 'winston';
import { serverConfig, configUtils } from './config';
import path from 'path';
import fs from 'fs';

const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const structuredFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS'
  }),
  winston.format.errors({ stack: true }),
  winston.format.metadata({
    fillExcept: ['message', 'level', 'timestamp', 'service']
  }),
  winston.format.json({
    space: configUtils.isDevelopment() ? 2 : 0
  })
);

const consoleFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'HH:mm:ss.SSS'
  }),
  winston.format.colorize({ all: true }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, service, metadata, ...rest }) => {
    let output = `${timestamp} [${service}] ${level}: ${message}`;
    
    // Add metadata if present
    const metaKeys = Object.keys(metadata || {});
    const restKeys = Object.keys(rest);
    const allMeta = { ...(metadata || {}), ...rest };
    
    if (metaKeys.length > 0 || restKeys.length > 0) {
      const metaStr = JSON.stringify(allMeta, null, 2);
      output += `\n${metaStr}`;
    }
    
    return output;
  })
);

export const logger = winston.createLogger({
  level: serverConfig.logLevel,
  format: structuredFormat,
  defaultMeta: { 
    service: 'shieldeye-api',
    environment: serverConfig.nodeEnv,
    version: process.env.npm_package_version || '1.0.0',
    pid: process.pid,
    hostname: require('os').hostname()
  },
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
      tailable: true,
      handleExceptions: true,
      handleRejections: true
    }),
    
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 50 * 1024 * 1024, // 50MB
      maxFiles: 10,
      tailable: true
    }),
    
    new winston.transports.File({
      filename: path.join(logsDir, 'audit.log'),
      level: 'info',
      maxsize: 20 * 1024 * 1024, // 20MB
      maxFiles: 20,
      tailable: true,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
        winston.format((info) => {
          // Only log audit-worthy events
          if (info.audit || info.level === 'error') {
            return info;
          }
          return false;
        })()
      )
    })
  ],
  
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'exceptions.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 3
    })
  ],
  
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'rejections.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 3
    })
  ]
});

if (!configUtils.isProduction()) {
  logger.add(new winston.transports.Console({
    format: consoleFormat,
    handleExceptions: true,
    handleRejections: true
  }));
}

export const contextLogger = {
  request: (requestId: string, method: string, url: string, metadata: any = {}) => {
    logger.info('HTTP Request', {
      requestId,
      method,
      url,
      audit: true,
      ...metadata
    });
  },
  
  response: (requestId: string, statusCode: number, responseTime: number, metadata: any = {}) => {
    logger.info('HTTP Response', {
      requestId,
      statusCode,
      responseTime,
      audit: true,
      ...metadata
    });
  },
  
  database: (operation: string, table: string, metadata: any = {}) => {
    logger.debug('Database Operation', {
      operation,
      table,
      ...metadata
    });
  },
  
  queue: (operation: string, queueName: string, jobId?: string, metadata: any = {}) => {
    logger.debug('Queue Operation', {
      operation,
      queueName,
      jobId,
      ...metadata
    });
  },
  
  security: (event: string, severity: 'low' | 'medium' | 'high' | 'critical', metadata: any = {}) => {
    const level = severity === 'critical' ? 'error' : severity === 'high' ? 'warn' : 'info';
    logger.log(level, `Security Event: ${event}`, {
      securityEvent: event,
      severity,
      audit: true,
      ...metadata
    });
  },
  
  performance: (operation: string, duration: number, metadata: any = {}) => {
    const level = duration > 5000 ? 'warn' : duration > 1000 ? 'info' : 'debug';
    logger.log(level, `Performance: ${operation}`, {
      operation,
      duration,
      performanceMetric: true,
      ...metadata
    });
  },
  
  business: (event: string, entityType: string, entityId: string, metadata: any = {}) => {
    logger.info(`Business Event: ${event}`, {
      businessEvent: event,
      entityType,
      entityId,
      audit: true,
      ...metadata
    });
  },
  
  error: (message: string, error: Error, context: any = {}) => {
    logger.error(message, {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: (error as any).code
      },
      ...context
    });
  },
  
  debug: (component: string, message: string, metadata: any = {}) => {
    logger.debug(`[${component}] ${message}`, metadata);
  }
};

logger.info('Logger initialized', {
  level: serverConfig.logLevel,
  environment: serverConfig.nodeEnv,
  transports: logger.transports.length,
  audit: true
});
