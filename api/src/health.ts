import { Request, Response } from 'express';
import { Database } from './database';
import { TaskQueue } from './queue';
import { logger, contextLogger } from './logger';
import { appConfig, serverConfig } from './config';
import Redis from 'ioredis';
import { Client as MinioClient } from 'minio';
import os from 'os';
import fs from 'fs';
import path from 'path';

interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  checks: {
    [key: string]: {
      status: 'pass' | 'fail' | 'warn';
      message?: string;
      duration?: number;
      metadata?: any;
    };
  };
  system: {
    memory: {
      used: number;
      free: number;
      total: number;
      percentage: number;
    };
    cpu: {
      loadAverage: number[];
      usage?: number;
    };
    disk: {
      used: number;
      free: number;
      total: number;
      percentage: number;
    };
    process: {
      pid: number;
      uptime: number;
      memoryUsage: NodeJS.MemoryUsage;
    };
  };
}

export class HealthChecker {
  private database: Database;
  private queue: TaskQueue;
  private redis: Redis;
  private minio: MinioClient;
  private startTime: number;
  private lastHealthCheck: HealthCheckResult | null = null;
  private lastHealthCheckTime: number = 0;
  private healthCheckCacheTTL: number = 30000;
  private concurrentHealthChecks: number = 0;
  private maxConcurrentHealthChecks: number = 3;

  constructor(database: Database, queue: TaskQueue) {
    this.database = database;
    this.queue = queue;
    this.startTime = Date.now();
    
    this.redis = new Redis({
      host: appConfig.redis.host,
      port: appConfig.redis.port,
      password: appConfig.redis.password,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      connectTimeout: 10000,
      commandTimeout: 5000
    });

    this.minio = new MinioClient({
      endPoint: appConfig.minio.endpoint.split(':')[0],
      port: parseInt(appConfig.minio.endpoint.split(':')[1] || '9000'),
      useSSL: false,
      accessKey: appConfig.minio.accessKey,
      secretKey: appConfig.minio.secretKey
    });
  }

  private async checkDatabase(): Promise<{ status: 'pass' | 'fail'; message?: string; duration: number; metadata?: any }> {
    const start = Date.now();
    try {
      const poolStats = this.database.getPoolStats();
      
      await this.database.ping();
      
      const duration = Date.now() - start;
      
      const isHealthy = poolStats.isHealthy && poolStats.totalCount > 0;
      const isWarning = poolStats.waitingCount > 10 || (poolStats.totalCount > 0 && poolStats.idleCount === 0);
      
      return {
        status: isHealthy ? (isWarning ? 'fail' : 'pass') : 'fail',
        message: isHealthy ? (isWarning ? 'High connection usage' : 'Database operational') : 'Database connection issues',
        duration,
        metadata: poolStats
      };
    } catch (error) {
      return {
        status: 'fail',
        message: error instanceof Error ? error.message : 'Database check failed',
        duration: Date.now() - start
      };
    }
  }

  private async checkRedis(): Promise<{ status: 'pass' | 'fail'; message?: string; duration: number; metadata?: any }> {
    const start = Date.now();
    try {
      const pong = await this.redis.ping();
      const info = await this.redis.info('memory');
      
      const duration = Date.now() - start;
      
      return {
        status: pong === 'PONG' ? 'pass' : 'fail',
        message: pong === 'PONG' ? 'Redis operational' : 'Redis ping failed',
        duration,
        metadata: {
          response: pong,
          memoryInfo: info.split('\r\n').filter(line => line.includes('used_memory')).slice(0, 3)
        }
      };
    } catch (error) {
      return {
        status: 'fail',
        message: error instanceof Error ? error.message : 'Redis check failed',
        duration: Date.now() - start
      };
    }
  }

  private async checkMinio(): Promise<{ status: 'pass' | 'fail'; message?: string; duration: number; metadata?: any }> {
    const start = Date.now();
    try {
      const bucketExists = await this.minio.bucketExists(appConfig.minio.bucket);
      
      if (!bucketExists) {
        return {
          status: 'fail',
          message: `Bucket '${appConfig.minio.bucket}' does not exist`,
          duration: Date.now() - start
        };
      }

      const testKey = `health-check-${Date.now()}`;
      const testData = Buffer.from('health-check-test');
      
      await this.minio.putObject(appConfig.minio.bucket, testKey, testData);
      await this.minio.removeObject(appConfig.minio.bucket, testKey);
      
      const duration = Date.now() - start;
      
      return {
        status: 'pass',
        message: 'MinIO operational',
        duration,
        metadata: {
          bucket: appConfig.minio.bucket,
          endpoint: appConfig.minio.endpoint
        }
      };
    } catch (error) {
      return {
        status: 'fail',
        message: error instanceof Error ? error.message : 'MinIO check failed',
        duration: Date.now() - start
      };
    }
  }

  private async checkQueue(): Promise<{ status: 'pass' | 'fail' | 'warn'; message?: string; duration: number; metadata?: any }> {
    const start = Date.now();
    try {
      const health = await this.queue.healthCheck();
      const stats = await this.queue.getDetailedQueueStats();
      const metrics = this.queue.getMetrics();
      
      const duration = Date.now() - start;
      
      const allHealthy = Object.values(health).every(h => h === true);
      const hasHighErrorRate = metrics.errorRate > 10;
      const hasStuckJobs = stats.scan.active > 0 && stats.scan.waiting === 0 && stats.scan.delayed === 0;
      
      let status: 'pass' | 'fail' | 'warn' = 'pass';
      let message = 'Queue system operational';
      
      if (!allHealthy) {
        status = 'fail';
        message = 'Queue system components failing';
      } else if (hasHighErrorRate || hasStuckJobs) {
        status = 'warn';
        message = hasHighErrorRate ? 'High error rate detected' : 'Potential stuck jobs detected';
      }
      
      return {
        status,
        message,
        duration,
        metadata: {
          health,
          stats,
          metrics: {
            errorRate: metrics.errorRate,
            throughputPerHour: metrics.throughputPerHour,
            avgProcessingTime: metrics.avgProcessingTime
          }
        }
      };
    } catch (error) {
      return {
        status: 'fail',
        message: error instanceof Error ? error.message : 'Queue check failed',
        duration: Date.now() - start
      };
    }
  }

  private async checkDiskSpace(): Promise<{ status: 'pass' | 'fail' | 'warn'; message?: string; metadata?: any }> {
    try {
      const stats = fs.statSync(process.cwd());
      const statvfs = fs.statSync(process.cwd());
      
      const logsDir = path.join(process.cwd(), 'logs');
      let logsDirSize = 0;
      
      if (fs.existsSync(logsDir)) {
        const files = fs.readdirSync(logsDir);
        logsDirSize = files.reduce((total, file) => {
          const filePath = path.join(logsDir, file);
          const stat = fs.statSync(filePath);
          return total + stat.size;
        }, 0);
      }
      
      const totalSpace = os.totalmem();
      const freeSpace = os.freemem();
      const usedSpace = totalSpace - freeSpace;
      const usagePercentage = (usedSpace / totalSpace) * 100;
      
      let status: 'pass' | 'fail' | 'warn' = 'pass';
      let message = 'Disk space sufficient';
      
      if (usagePercentage > 90) {
        status = 'fail';
        message = 'Critical disk space usage';
      } else if (usagePercentage > 80) {
        status = 'warn';
        message = 'High disk space usage';
      }
      
      return {
        status,
        message,
        metadata: {
          total: totalSpace,
          used: usedSpace,
          free: freeSpace,
          percentage: usagePercentage,
          logsSize: logsDirSize
        }
      };
    } catch (error) {
      return {
        status: 'fail',
        message: error instanceof Error ? error.message : 'Disk space check failed'
      };
    }
  }

  private getSystemMetrics() {
    const memoryUsage = process.memoryUsage();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    
    return {
      memory: {
        used: usedMemory,
        free: freeMemory,
        total: totalMemory,
        percentage: (usedMemory / totalMemory) * 100
      },
      cpu: {
        loadAverage: os.loadavg()
      },
      disk: {
        used: 0, // Simplified - would need platform-specific implementation
        free: 0,
        total: 0,
        percentage: 0
      },
      process: {
        pid: process.pid,
        uptime: process.uptime(),
        memoryUsage
      }
    };
  }

  async performHealthCheck(useCache: boolean = true): Promise<HealthCheckResult> {
    if (useCache && this.lastHealthCheck && 
        (Date.now() - this.lastHealthCheckTime) < this.healthCheckCacheTTL) {
      contextLogger.debug('HealthChecker', 'Returning cached health check result');
      return this.lastHealthCheck;
    }
    
    if (this.concurrentHealthChecks >= this.maxConcurrentHealthChecks) {
      logger.warn('Too many concurrent health checks, returning cached or degraded result');
      if (this.lastHealthCheck) {
        return {
          ...this.lastHealthCheck,
          status: 'degraded',
          timestamp: new Date().toISOString()
        };
      }
    }
    
    this.concurrentHealthChecks++;
    const startTime = Date.now();
    
    try {
      contextLogger.debug('HealthChecker', 'Starting comprehensive health check');
    
    const [
      databaseCheck,
      redisCheck,
      minioCheck,
      queueCheck,
      diskCheck
    ] = await Promise.allSettled([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkMinio(),
      this.checkQueue(),
      this.checkDiskSpace()
    ]);

    const checks: HealthCheckResult['checks'] = {};
    
    if (databaseCheck.status === 'fulfilled') {
      checks.database = databaseCheck.value;
    } else {
      checks.database = { status: 'fail', message: 'Database check threw exception' };
    }
    
    if (redisCheck.status === 'fulfilled') {
      checks.redis = redisCheck.value;
    } else {
      checks.redis = { status: 'fail', message: 'Redis check threw exception' };
    }
    
    if (minioCheck.status === 'fulfilled') {
      checks.minio = minioCheck.value;
    } else {
      checks.minio = { status: 'fail', message: 'MinIO check threw exception' };
    }
    
    if (queueCheck.status === 'fulfilled') {
      checks.queue = queueCheck.value;
    } else {
      checks.queue = { status: 'fail', message: 'Queue check threw exception' };
    }
    
    if (diskCheck.status === 'fulfilled') {
      checks.disk = diskCheck.value;
    } else {
      checks.disk = { status: 'fail', message: 'Disk check threw exception' };
    }

    // Determine overall status
    const checkValues = Object.values(checks);
    const failedChecks = checkValues.filter(c => c.status === 'fail').length;
    const warnChecks = checkValues.filter(c => c.status === 'warn').length;
    
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
    if (failedChecks === 0 && warnChecks === 0) {
      overallStatus = 'healthy';
    } else if (failedChecks === 0) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'unhealthy';
    }

    const result: HealthCheckResult = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      version: process.env.npm_package_version || '1.0.0',
      environment: serverConfig.nodeEnv,
      checks,
      system: this.getSystemMetrics()
    };

    const duration = Date.now() - startTime;
    contextLogger.performance('health-check', duration, {
      status: overallStatus,
      failedChecks,
      warnChecks
    });

    // Cache the result
    this.lastHealthCheck = result;
    this.lastHealthCheckTime = Date.now();

    return result;
    } finally {
      this.concurrentHealthChecks--;
    }
  }

  // Express route handlers
  async healthHandler(req: Request, res: Response): Promise<void> {
    try {
      // Use cache for frequent requests to reduce load
      const useCache = req.query.nocache !== 'true';
      const health = await this.performHealthCheck(useCache);
      
      const statusCode = health.status === 'healthy' ? 200 : 
                        health.status === 'degraded' ? 200 : 503;
      
      // Add cache headers
      res.set({
        'Cache-Control': 'public, max-age=30',
        'X-Health-Check-Cached': this.lastHealthCheck && useCache ? 'true' : 'false'
      });
      
      res.status(statusCode).json(health);
    } catch (error) {
      contextLogger.error('Health check failed', error as Error, {
        requestId: req.id,
        endpoint: '/health'
      });
      
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Health check system failure'
      });
    }
  }

  async readinessHandler(req: Request, res: Response): Promise<void> {
    try {
      // Quick readiness check - just essential services with timeout
      const [dbCheck, redisCheck] = await Promise.allSettled([
        Promise.race([
          this.checkDatabase(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Database check timeout')), 5000)
          )
        ]),
        Promise.race([
          this.checkRedis(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Redis check timeout')), 5000)
          )
        ])
      ]);

      const isReady = dbCheck.status === 'fulfilled' && (dbCheck.value as any).status === 'pass' &&
                     redisCheck.status === 'fulfilled' && (redisCheck.value as any).status === 'pass';

      if (isReady) {
        res.status(200).json({
          status: 'ready',
          timestamp: new Date().toISOString(),
          checks: {
            database: dbCheck.status === 'fulfilled' ? dbCheck.value : { status: 'fail' },
            redis: redisCheck.status === 'fulfilled' ? redisCheck.value : { status: 'fail' }
          }
        });
      } else {
        res.status(503).json({
          status: 'not-ready',
          timestamp: new Date().toISOString(),
          checks: {
            database: dbCheck.status === 'fulfilled' ? dbCheck.value : { status: 'fail' },
            redis: redisCheck.status === 'fulfilled' ? redisCheck.value : { status: 'fail' }
          }
        });
      }
    } catch (error) {
      res.status(503).json({
        status: 'not-ready',
        timestamp: new Date().toISOString(),
        error: 'Readiness check failed'
      });
    }
  }

  async livenessHandler(req: Request, res: Response): Promise<void> {
    // Simple liveness check - just verify the process is responsive
    try {
      const memoryUsage = process.memoryUsage();
      const isMemoryHealthy = memoryUsage.heapUsed < (memoryUsage.heapTotal * 0.9);
      
      res.status(200).json({
        status: isMemoryHealthy ? 'alive' : 'degraded',
        timestamp: new Date().toISOString(),
        uptime: Date.now() - this.startTime,
        pid: process.pid,
        memory: {
          heapUsed: memoryUsage.heapUsed,
          heapTotal: memoryUsage.heapTotal,
          heapPercentage: (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100
        }
      });
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Liveness check failed'
      });
    }
  }

  async metricsHandler(req: Request, res: Response): Promise<void> {
    try {
      const queueMetrics = this.queue.getMetrics();
      const queueStats = await this.queue.getDetailedQueueStats();
      const dbStats = this.database.getPoolStats();
      const systemMetrics = this.getSystemMetrics();

      const metrics = {
        timestamp: new Date().toISOString(),
        system: systemMetrics,
        database: dbStats,
        queue: {
          metrics: queueMetrics,
          stats: queueStats
        },
        application: {
          uptime: Date.now() - this.startTime,
          version: process.env.npm_package_version || '1.0.0',
          environment: serverConfig.nodeEnv,
          nodeVersion: process.version
        }
      };

      res.status(200).json(metrics);
    } catch (error) {
      contextLogger.error('Metrics collection failed', error as Error, {
        requestId: req.id,
        endpoint: '/metrics'
      });
      
      res.status(500).json({
        error: 'Metrics collection failed',
        timestamp: new Date().toISOString()
      });
    }
  }

  async close(): Promise<void> {
    this.redis.disconnect();
  }
}
