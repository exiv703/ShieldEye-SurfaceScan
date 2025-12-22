import { Router, Request, Response } from 'express';
import { Database } from '../database';
import { TaskQueue } from '../queue';
import { logger } from '../logger';
import { recordAIAnalysis } from '../metrics';

export class AIRoutes {
  private router: Router;
  private database: Database;
  private taskQueue: TaskQueue;

  constructor(database: Database, taskQueue: TaskQueue) {
    this.router = Router();
    this.database = database;
    this.taskQueue = taskQueue;
    this.setupRoutes();
  }

  private setupRoutes(): void {
    /**
     * @swagger
     * /api/ai/metrics:
     *   get:
     *     summary: Get AI analysis and threat metrics
     *     tags: [AI]
     *     responses:
     *       200:
     *         description: AI metrics payload
     *         content:
     *           application/json:
     *             schema:
     *               type: object
     *               properties:
     *                 threats:
     *                   type: object
     *                   additionalProperties:
     *                     type: integer
     *                 totals:
     *                   type: object
     *                   properties:
     *                     threatsDetected:
     *                       type: integer
     *                 models:
     *                   type: object
     *                   properties:
     *                     active:
     *                       type: integer
     *                 processing:
     *                   type: object
     *                   properties:
     *                     avgScanDurationSeconds:
     *                       type: number
     */
    this.router.get('/metrics', this.getMetrics.bind(this));
  }

  private async getMetrics(_req: Request, res: Response): Promise<void> {
    try {
      const [severityCounts, avgDuration, queueStats] = await Promise.all([
        this.database.getFindingsSeverityCounts(),
        this.database.getAverageScanDurationSeconds(),
        this.taskQueue.getQueueStats(),
      ]);

      const critical = severityCounts['critical'] || 0;
      const high = severityCounts['high'] || 0;
      const medium = severityCounts['medium'] || 0;
      const low = severityCounts['low'] || 0;
      const info = severityCounts['info'] || 0;
      const total = critical + high + medium + low + info;

      const payload = {
        threats: {
          critical,
          high,
          medium,
          low,
          info,
        },
        totals: {
          threatsDetected: total,
        },
        models: {
          active: queueStats.active,
        },
        processing: {
          avgScanDurationSeconds: Math.round((avgDuration || 0) * 10) / 10,
        },
      };

      recordAIAnalysis('threat-metrics', 'success');
      res.json(payload);
    } catch (error) {
      logger.error('Failed to compute AI metrics', {
        error: error instanceof Error ? error.message : String(error),
      });
      try { recordAIAnalysis('threat-metrics', 'failed'); } catch (_) {}
      res.status(500).json({ error: 'Failed to compute AI metrics' });
    }
  }

  getRouter(): Router {
    return this.router;
  }
}
