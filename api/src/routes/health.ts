import { Router } from 'express';
import { HealthChecker } from '../health';
import { Database } from '../database';
import { TaskQueue } from '../queue';
import { contextLogger } from '../logger';

export function createHealthRoutes(database: Database, queue: TaskQueue): Router {
  const router = Router();
  const healthChecker = new HealthChecker(database, queue);

  // Comprehensive health check endpoint
  router.get('/health', async (req, res) => {
    contextLogger.request(req.id, req.method, req.originalUrl, {
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });
    
    await healthChecker.healthHandler(req, res);
    
    contextLogger.response(req.id, res.statusCode, 0, {
      endpoint: '/health'
    });
  });

  // Kubernetes readiness probe endpoint
  router.get('/ready', async (req, res) => {
    await healthChecker.readinessHandler(req, res);
  });

  // Kubernetes liveness probe endpoint
  router.get('/live', async (req, res) => {
    await healthChecker.livenessHandler(req, res);
  });

  // Detailed metrics endpoint
  router.get('/metrics', async (req, res) => {
    contextLogger.request(req.id, req.method, req.originalUrl, {
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });
    
    await healthChecker.metricsHandler(req, res);
    
    contextLogger.response(req.id, res.statusCode, 0, {
      endpoint: '/metrics'
    });
  });

  // Queue-specific health and management endpoints
  router.get('/queue/stats', async (req, res) => {
    try {
      const stats = await queue.getDetailedQueueStats();
      res.json(stats);
    } catch (error) {
      contextLogger.error('Queue stats failed', error as Error, {
        requestId: req.id
      });
      res.status(500).json({ error: 'Failed to get queue stats' });
    }
  });

  router.get('/queue/health', async (req, res) => {
    try {
      const health = await queue.healthCheck();
      const isHealthy = Object.values(health).every(h => h === true);
      
      res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? 'healthy' : 'unhealthy',
        checks: health,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      contextLogger.error('Queue health check failed', error as Error, {
        requestId: req.id
      });
      res.status(503).json({ 
        status: 'unhealthy',
        error: 'Queue health check failed',
        timestamp: new Date().toISOString()
      });
    }
  });

  router.get('/queue/dead-letter', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const deadJobs = await queue.getDeadLetterJobs(limit);
      
      res.json({
        jobs: deadJobs,
        count: deadJobs.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      contextLogger.error('Dead letter jobs retrieval failed', error as Error, {
        requestId: req.id
      });
      res.status(500).json({ error: 'Failed to get dead letter jobs' });
    }
  });

  // Database health endpoint
  router.get('/database/health', async (req, res) => {
    try {
      const stats = database.getPoolStats();
      const isHealthy = stats.isHealthy && stats.totalCount > 0;
      
      res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? 'healthy' : 'unhealthy',
        stats,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      contextLogger.error('Database health check failed', error as Error, {
        requestId: req.id
      });
      res.status(503).json({ 
        status: 'unhealthy',
        error: 'Database health check failed',
        timestamp: new Date().toISOString()
      });
    }
  });

  return router;
}