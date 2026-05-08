/**
 * Dependency diagram:
 * index.ts -> RouteRegistrar -> Scan/AI/Analytics routers
 */
import type express from 'express';
import { ScanRoutes } from '../routes/scans';
import { AIRoutes } from '../routes/ai';
import { AnalyticsRoutes } from '../routes/analytics';
import { createMinimalRouter } from '../minimal/router';
import { cacheMiddleware } from '../performance';
import { logger } from '../logger';
import type { Database } from '../database';
import type { TaskQueue } from '../queue';

export class RouteRegistrar {
  constructor(
    private readonly app: express.Application,
    private readonly database: Database,
    private readonly taskQueue: TaskQueue,
  ) {}

  registerCoreRoutes(): void {
    const scanRoutes = new ScanRoutes(this.database, this.taskQueue);
    this.app.use('/api/scans', cacheMiddleware(10), scanRoutes.getRouter());

    const aiRoutes = new AIRoutes(this.database, this.taskQueue);
    this.app.use('/api/ai', aiRoutes.getRouter());

    const analyticsRoutes = new AnalyticsRoutes(this.database);
    this.app.use('/api/analytics', cacheMiddleware(300), analyticsRoutes.getRouter());

    if ((process.env.ENABLE_MINIMAL_ROUTES || 'false').toLowerCase() === 'true') {
      this.app.use('/api/minimal', createMinimalRouter({ database: this.database, taskQueue: this.taskQueue }));
    }

    this.app.get('/api/queue/stats', async (_req, res) => {
      try {
        const stats = await this.taskQueue.getQueueStats();
        res.json(stats);
      } catch (error) {
        logger.error('Failed to get queue stats', {
          error: error instanceof Error ? error.message : error,
        });
        res.status(500).json({ error: 'Failed to get queue stats' });
      }
    });
  }
}
