/**
 * Dependency diagram:
 * index.ts -> AppBootstrap -> server lifecycle
 * index.ts -> MiddlewareLoader -> security/rate-limit middleware
 */
import type express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import type { ServerConfigType } from '../config';
import { logger } from '../logger';
import { shutdownTracing } from '../tracing';

export class MiddlewareLoader {
  constructor(private readonly app: express.Application, private readonly serverConfig: ServerConfigType) {}

  loadSecurityMiddleware(): void {
    this.app.set('trust proxy', 1);
    this.app.set('x-powered-by', false);
    this.app.set('etag', 'strong');

    this.app.use(helmet());
    this.app.use(cors({ origin: this.serverConfig.corsOrigin }));

    this.app.use(rateLimit({
      windowMs: this.serverConfig.rateLimitWindowMs,
      max: this.serverConfig.rateLimitMax * 2,
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        error: 'Too many requests',
        details: 'Rate limit exceeded. Please try again later.',
        retryAfter: Math.ceil(this.serverConfig.rateLimitWindowMs / 1000),
        limit: this.serverConfig.rateLimitMax * 2,
      },
      skip: (req) => req.path === '/health' || req.path === '/ready' || req.path === '/live',
      keyGenerator: (req) => `${req.ip}-${req.get('User-Agent')?.substring(0, 50) || 'unknown'}`,
    }));

    const aiRateLimiter = rateLimit({
      windowMs: parseInt(process.env.AI_RATE_LIMIT_WINDOW_MS || '60000', 10),
      max: parseInt(process.env.AI_RATE_LIMIT_MAX || '10', 10),
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        error: 'Too many AI requests',
        details: 'AI endpoint rate limit exceeded. Please slow down your requests.',
      },
      keyGenerator: (req) => `${req.ip}-${req.get('User-Agent')?.substring(0, 50) || 'unknown'}`,
    });

    this.app.use('/api/ai', aiRateLimiter);
  }
}

export interface AppBootstrapDeps {
  closeDatabase(): Promise<void>;
  closeTaskQueue(): Promise<void>;
  closeWebSockets(): void;
}

export class AppBootstrap {
  constructor(
    private readonly app: express.Application,
    private readonly port: number,
    private readonly deps: AppBootstrapDeps,
  ) {}

  start(onStarted?: (server: import('http').Server) => void): import('http').Server {
    const server = this.app.listen(this.port, () => {
      logger.info(`ShieldEye API running on port ${this.port}`, { port: this.port });
      if (onStarted) {
        onStarted(server);
      }
    });

    process.on('SIGINT', () => this.shutdown(server, 'SIGINT'));
    process.on('SIGTERM', () => this.shutdown(server, 'SIGTERM'));

    return server;
  }

  private shutdown(server: import('http').Server, signal: string): void {
    logger.info(`Received ${signal}, shutting down...`);
    server.close(async () => {
      try {
        await Promise.all([
          this.deps.closeDatabase(),
          this.deps.closeTaskQueue(),
          shutdownTracing(),
        ]);
        this.deps.closeWebSockets();
        logger.info('Shutdown complete');
        process.exit(0);
      } catch (error) {
        logger.error('Error during shutdown', { error: error instanceof Error ? error.message : error });
        process.exit(1);
      }
    });
  }
}
