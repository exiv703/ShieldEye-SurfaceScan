import Queue, { Job } from 'bull';
import Redis from 'ioredis';
import { WebSocketManager } from './websocket';
import { appConfig, serverConfig } from './config';
import { ScanTask, TaskResult } from '@shieldeye/shared';
import { logger } from './logger';

interface QueueMetrics {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  activeJobs: number;
  waitingJobs: number;
  delayedJobs: number;
  pausedJobs: number;
  avgProcessingTime: number;
  throughputPerHour: number;
  errorRate: number;
  retryRate: number;
}

interface DeadLetterJob {
  id: string;
  data: ScanTask;
  error: string;
  attempts: number;
  timestamp: Date;
  lastAttempt: Date;
}

export class TaskQueue {
  private redis: Redis;
  private scanQueue: import('bull').Queue<ScanTask>;
  private deadLetterQueue: import('bull').Queue<DeadLetterJob>;
  private metricsInterval: NodeJS.Timeout | null = null;
  private wsManager?: WebSocketManager;
  private metrics: QueueMetrics = {
    totalJobs: 0,
    completedJobs: 0,
    failedJobs: 0,
    activeJobs: 0,
    waitingJobs: 0,
    delayedJobs: 0,
    pausedJobs: 0,
    avgProcessingTime: 0,
    throughputPerHour: 0,
    errorRate: 0,
    retryRate: 0
  };
  private processingTimes: number[] = [];
  private hourlyCompletions: number = 0;
  private hourlyFailures: number = 0;
  private hourlyRetries: number = 0;

  constructor() {
    this.redis = new Redis({
      host: appConfig.redis.host,
      port: appConfig.redis.port,
      password: appConfig.redis.password,
      maxRetriesPerRequest: null, // Allow unlimited retries for connection recovery
      enableReadyCheck: true,
      lazyConnect: true,
      keepAlive: 30000,
      connectTimeout: 10000,
      commandTimeout: 5000,
      enableOfflineQueue: false
    });
    // Proactively establish Redis connection since enableOfflineQueue=false with lazyConnect
    this.redis.connect().catch((err) => {
      logger.error('Redis initial connect failed', {
        error: err instanceof Error ? err.message : err
      });
    });
    
    // Enhanced Redis error handling
    this.redis.on('error', (err) => {
      logger.error('Redis connection error', {
        error: err.message,
        code: (err as any).code,
        address: (err as any).address
      });
    });
    
    this.redis.on('connect', () => {
      logger.info('Redis connected successfully');
    });
    
    this.redis.on('reconnecting', (delay: number) => {
      logger.warn('Redis reconnecting', { delay });
    });
    
    this.redis.on('end', () => {
      logger.warn('Redis connection ended');
    });

    const queueConfig = {
      redis: {
        host: appConfig.redis.host,
        port: appConfig.redis.port,
        password: appConfig.redis.password,
        maxRetriesPerRequest: null,
        connectTimeout: 10000,
        commandTimeout: 5000,
        enableOfflineQueue: false,
        lazyConnect: true
      },
      settings: {
        stalledInterval: 30000,
        maxStalledCount: 1
      }
    };

    this.scanQueue = new Queue<ScanTask>('scan-queue', {
      ...queueConfig,
      defaultJobOptions: {
        removeOnComplete: parseInt(process.env.QUEUE_KEEP_COMPLETED || '100'),
        removeOnFail: parseInt(process.env.QUEUE_KEEP_FAILED || '200'),
        attempts: parseInt(process.env.QUEUE_MAX_ATTEMPTS || '5'),
        backoff: {
          type: 'exponential',
          delay: parseInt(process.env.QUEUE_RETRY_DELAY || '2000')
        },
        jobId: undefined, // Will be set per job
        delay: 0,
        priority: 0,
        repeat: undefined,
        timeout: parseInt(process.env.QUEUE_JOB_TIMEOUT || '600000') // 10 minutes
      }
    });

    this.deadLetterQueue = new Queue<DeadLetterJob>('dead-letter-queue', {
      ...queueConfig,
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 1000,
        attempts: 1, // Dead letter jobs are not retried
        delay: 0
      }
    });

    this.setupEventHandlers();
    this.startMetricsCollection();
  }

  setWebSocketManager(manager: WebSocketManager) {
    this.wsManager = manager;
  }

  private setupEventHandlers(): void {
    // Scan queue event handlers
    this.scanQueue.on('completed', (job: Job<ScanTask>, result: TaskResult) => {
      const processingTime = Date.now() - job.processedOn!;
      this.processingTimes.push(processingTime);
      if (this.processingTimes.length > 1000) {
        this.processingTimes = this.processingTimes.slice(-500); // Keep last 500 times
      }
      this.hourlyCompletions++;
      
      logger.info(`Scan job completed`, { 
        jobId: job.id, 
        scanId: result.scanId,
        success: result.success,
        processingTime
      });

      try {
        this.wsManager?.broadcastScanUpdate(result.scanId, 'completed', 100);
      } catch (e) {
        logger.warn('WS broadcast failed on completed', { error: e instanceof Error ? e.message : e });
      }
    });

    this.scanQueue.on('failed', (job: Job<ScanTask>, err: Error) => {
      this.hourlyFailures++;
      
      logger.error(`Scan job failed`, { 
        jobId: job.id, 
        error: err.message,
        scanId: job.data.scanId,
        attempts: job.attemptsMade,
        maxAttempts: job.opts.attempts
      });
      
      try {
        this.wsManager?.broadcastScanUpdate(job.data.scanId, 'failed', 100);
      } catch (e) {
        logger.warn('WS broadcast failed on failed', { error: e instanceof Error ? e.message : e });
      }

      // Move to dead letter queue if max attempts reached
      if (job.attemptsMade >= (job.opts.attempts || 5)) {
        this.moveToDeadLetterQueue(job, err).catch(dlqError => {
          logger.error('Failed to move job to dead letter queue', {
            jobId: job.id,
            scanId: job.data.scanId,
            error: dlqError.message
          });
        });
      }
    });

    this.scanQueue.on('stalled', (job: Job<ScanTask>) => {
      logger.warn(`Scan job stalled`, { 
        jobId: job.id,
        scanId: job.data.scanId,
        attempts: job.attemptsMade
      });
    });
    
    this.scanQueue.on('progress', (job: Job<ScanTask>, progress: number) => {
      logger.debug(`Scan job progress`, {
        jobId: job.id,
        scanId: job.data.scanId,
        progress
      });

      try {
        this.wsManager?.broadcastScanUpdate(job.data.scanId, 'running', progress);
      } catch (e) {
        logger.warn('WS broadcast failed on progress', { error: e instanceof Error ? e.message : e });
      }
    });
    
    this.scanQueue.on('waiting', (jobId: string) => {
      logger.debug(`Scan job waiting`, { jobId });
    });
    
    this.scanQueue.on('active', (job: Job<ScanTask>) => {
      logger.debug(`Scan job started`, {
        jobId: job.id,
        scanId: job.data.scanId
      });

      try {
        this.wsManager?.broadcastScanUpdate(job.data.scanId, 'running', 0);
      } catch (e) {
        logger.warn('WS broadcast failed on active', { error: e instanceof Error ? e.message : e });
      }
    });
    
    this.scanQueue.on('paused', () => {
      logger.info('Scan queue paused');
    });
    
    this.scanQueue.on('resumed', () => {
      logger.info('Scan queue resumed');
    });
    
    this.scanQueue.on('cleaned', (jobs: Job[], type: string) => {
      logger.info(`Cleaned ${jobs.length} ${type} jobs from scan queue`);
    });
    
    // Dead letter queue event handlers
    this.deadLetterQueue.on('completed', (job: Job<DeadLetterJob>) => {
      logger.info('Dead letter job processed', {
        jobId: job.id,
        originalScanId: job.data.data.scanId
      });
    });
    
    this.deadLetterQueue.on('failed', (job: Job<DeadLetterJob>, err: Error) => {
      logger.error('Dead letter job failed', {
        jobId: job.id,
        originalScanId: job.data.data.scanId,
        error: err.message
      });
    });
  }

  private async moveToDeadLetterQueue(job: Job<ScanTask>, error: Error): Promise<void> {
    const deadLetterJob: DeadLetterJob = {
      id: job.id?.toString() || 'unknown',
      data: job.data,
      error: error.message,
      attempts: job.attemptsMade,
      timestamp: new Date(),
      lastAttempt: new Date(job.processedOn || Date.now())
    };
    
    await this.deadLetterQueue.add('dead-letter', deadLetterJob, {
      jobId: `dl-${job.data.scanId}-${Date.now()}`
    });
  }
  
  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(async () => {
      await this.updateMetrics();
    }, 60000); // Update metrics every minute
    
    // Reset hourly counters every hour
    setInterval(() => {
      this.hourlyCompletions = 0;
      this.hourlyFailures = 0;
      this.hourlyRetries = 0;
    }, 3600000); // 1 hour
  }
  
  private async updateMetrics(): Promise<void> {
    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        this.scanQueue.getWaiting(),
        this.scanQueue.getActive(),
        this.scanQueue.getCompleted(),
        this.scanQueue.getFailed(),
        this.scanQueue.getDelayed()
      ]);
      
      const isPaused = await this.scanQueue.isPaused();
      
      this.metrics = {
        totalJobs: waiting.length + active.length + completed.length + failed.length,
        completedJobs: completed.length,
        failedJobs: failed.length,
        activeJobs: active.length,
        waitingJobs: waiting.length,
        delayedJobs: delayed.length,
        pausedJobs: isPaused ? 1 : 0,
        avgProcessingTime: this.processingTimes.length > 0 
          ? this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length 
          : 0,
        throughputPerHour: this.hourlyCompletions,
        errorRate: this.metrics.totalJobs > 0 
          ? (this.hourlyFailures / Math.max(this.hourlyCompletions + this.hourlyFailures, 1)) * 100 
          : 0,
        retryRate: this.metrics.totalJobs > 0 
          ? (this.hourlyRetries / Math.max(this.metrics.totalJobs, 1)) * 100 
          : 0
      };
    } catch (error) {
      logger.error('Failed to update queue metrics', {
        error: error instanceof Error ? error.message : error
      });
    }
  }

  async addScanJob(task: ScanTask, options: {
    priority?: number;
    delay?: number;
    attempts?: number;
    timeout?: number;
  } = {}): Promise<Job<ScanTask>> {
    const jobOptions = {
      priority: options.priority || 1,
      delay: options.delay || 0,
      jobId: task.scanId,
      attempts: options.attempts || parseInt(process.env.QUEUE_MAX_ATTEMPTS || '5'),
      timeout: options.timeout || parseInt(process.env.QUEUE_JOB_TIMEOUT || '600000'),
      backoff: {
        type: 'exponential' as const,
        delay: parseInt(process.env.QUEUE_RETRY_DELAY || '2000')
      }
    };
    
    logger.debug('Adding scan job to queue', {
      scanId: task.scanId,
      priority: jobOptions.priority,
      delay: jobOptions.delay,
      attempts: jobOptions.attempts
    });
    
    return this.scanQueue.add('scan', task, jobOptions);
  }

  async getScanJobStatus(scanId: string): Promise<{
    status: string;
    progress: number;
    result?: TaskResult;
    error?: string;
    attempts?: number;
    maxAttempts?: number;
    createdAt?: Date;
    processedOn?: Date;
    finishedOn?: Date;
  } | null> {
    const job = await this.scanQueue.getJob(scanId);
    if (!job) {
      // Check dead letter queue
      const deadLetterJobs = await this.deadLetterQueue.getJobs(['completed', 'failed'], 0, 100);
      const deadJob = deadLetterJobs.find(j => j.data.data.scanId === scanId);
      if (deadJob) {
        return {
          status: 'dead-letter',
          progress: 100,
          error: deadJob.data.error,
          attempts: deadJob.data.attempts,
          maxAttempts: deadJob.data.attempts,
          createdAt: deadJob.data.timestamp,
          processedOn: deadJob.data.lastAttempt,
          finishedOn: deadJob.data.lastAttempt
        };
      }
      return null;
    }

    const state = await job.getState();
    const progress = job.progress();
    
    let result: TaskResult | undefined;
    let error: string | undefined;

    if (state === 'completed') {
      result = job.returnvalue;
    } else if (state === 'failed') {
      error = job.failedReason;
    }

    return {
      status: state,
      progress: typeof progress === 'number' ? progress : 0,
      result,
      error,
      attempts: job.attemptsMade,
      maxAttempts: job.opts.attempts,
      createdAt: new Date(job.timestamp),
      processedOn: job.processedOn ? new Date(job.processedOn) : undefined,
      finishedOn: job.finishedOn ? new Date(job.finishedOn) : undefined
    };
  }

  async retryJob(scanId: string): Promise<boolean> {
    try {
      const job = await this.scanQueue.getJob(scanId);
      if (!job) {
        // Check dead letter queue
        const deadLetterJobs = await this.deadLetterQueue.getJobs(['completed', 'failed'], 0, 100);
        const deadJob = deadLetterJobs.find(j => j.data.data.scanId === scanId);
        if (deadJob) {
          // Re-queue the original task
          await this.addScanJob(deadJob.data.data);
          await deadJob.remove();
          logger.info('Job requeued from dead letter queue', { scanId });
          return true;
        }
        return false;
      }
      
      await job.retry();
      this.hourlyRetries++;
      logger.info('Job retried', { scanId, jobId: job.id });
      return true;
    } catch (error) {
      logger.error('Failed to retry job', {
        scanId,
        error: error instanceof Error ? error.message : error
      });
      return false;
    }
  }
  
  async getDeadLetterJobs(limit: number = 50): Promise<DeadLetterJob[]> {
    const jobs = await this.deadLetterQueue.getJobs(['completed', 'failed'], 0, limit);
    return jobs.map(job => job.data);
  }
  
  async clearDeadLetterQueue(): Promise<number> {
    const jobs = await this.deadLetterQueue.getJobs(['completed', 'failed'], 0, -1);
    await Promise.all(jobs.map(job => job.remove()));
    logger.info(`Cleared ${jobs.length} jobs from dead letter queue`);
    return jobs.length;
  }
  
  getMetrics(): QueueMetrics {
    return { ...this.metrics };
  }
  
  async getDetailedQueueStats(): Promise<{
    scan: {
      waiting: number;
      active: number;
      completed: number;
      failed: number;
      delayed: number;
      paused: boolean;
    };
    deadLetter: {
      total: number;
    };
    metrics: QueueMetrics;
  }> {
    const [scanWaiting, scanActive, scanCompleted, scanFailed, scanDelayed] = await Promise.all([
      this.scanQueue.getWaiting(),
      this.scanQueue.getActive(),
      this.scanQueue.getCompleted(),
      this.scanQueue.getFailed(),
      this.scanQueue.getDelayed()
    ]);
    
    const scanPaused = await this.scanQueue.isPaused();
    const deadLetterJobs = await this.deadLetterQueue.getJobs(['completed', 'failed'], 0, -1);
    
    return {
      scan: {
        waiting: scanWaiting.length,
        active: scanActive.length,
        completed: scanCompleted.length,
        failed: scanFailed.length,
        delayed: scanDelayed.length,
        paused: scanPaused
      },
      deadLetter: {
        total: deadLetterJobs.length
      },
      metrics: this.getMetrics()
    };
  }

  async getQueueStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }> {
    const [waiting, active, completed, failed] = await Promise.all([
      this.scanQueue.getWaiting(),
      this.scanQueue.getActive(),
      this.scanQueue.getCompleted(),
      this.scanQueue.getFailed()
    ]);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length
    };
  }

  async pauseQueue(): Promise<void> {
    await this.scanQueue.pause();
    logger.info('Queue paused');
  }

  async resumeQueue(): Promise<void> {
    await this.scanQueue.resume();
    logger.info('Queue resumed');
  }
  
  async drainQueue(): Promise<void> {
    // Wait for all active jobs to complete
    const activeJobs = await this.scanQueue.getActive();
    if (activeJobs.length > 0) {
      logger.info(`Waiting for ${activeJobs.length} active jobs to complete`);
      await Promise.all(activeJobs.map(job => job.finished()));
    }
    logger.info('Queue drained');
  }
  
  async obliterateQueue(): Promise<void> {
    await this.scanQueue.obliterate({ force: true });
    await this.deadLetterQueue.obliterate({ force: true });
    logger.warn('Queues obliterated - all jobs removed');
  }

  async cleanQueue(options: {
    completedOlderThan?: number;
    failedOlderThan?: number;
    activeOlderThan?: number;
    limit?: number;
  } = {}): Promise<{
    completed: number;
    failed: number;
    active: number;
  }> {
    const {
      completedOlderThan = 24 * 60 * 60 * 1000, // 24 hours
      failedOlderThan = 7 * 24 * 60 * 60 * 1000, // 7 days
      activeOlderThan = 60 * 60 * 1000, // 1 hour
      limit = 1000
    } = options;
    
    const [completedCleaned, failedCleaned, activeCleaned] = await Promise.all([
      this.scanQueue.clean(completedOlderThan, 'completed', limit),
      this.scanQueue.clean(failedOlderThan, 'failed', limit),
      this.scanQueue.clean(activeOlderThan, 'active', limit)
    ]);
    
    // Clean dead letter queue
    const deadLetterCleaned = await this.deadLetterQueue.clean(
      7 * 24 * 60 * 60 * 1000, // 7 days
      'completed',
      limit
    );
    
    const result = {
      completed: completedCleaned.length,
      failed: failedCleaned.length,
      active: activeCleaned.length
    };
    
    logger.info('Queue cleaned', {
      ...result,
      deadLetterCleaned: deadLetterCleaned.length
    });
    
    return result;
  }
  
  async healthCheck(): Promise<{
    redis: boolean;
    scanQueue: boolean;
    deadLetterQueue: boolean;
    metrics: boolean;
  }> {
    const health = {
      redis: false,
      scanQueue: false,
      deadLetterQueue: false,
      metrics: false
    };
    
    try {
      // Ensure connection is established before ping when lazyConnect=true and offline queue disabled
      if (this.redis.status !== 'ready') {
        try { await this.redis.connect(); } catch (e) { /* ignore, handled below by ping */ }
      }
      // Test Redis connection with timeout
      await Promise.race([
        this.redis.ping(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Redis ping timeout')), 5000)
        )
      ]);
      health.redis = true;
    } catch (error) {
      logger.error('Redis health check failed', {
        error: error instanceof Error ? error.message : error,
        redisStatus: this.redis.status
      });
      
      // Attempt to reconnect if disconnected
      if (this.redis.status === 'end' || this.redis.status === 'close') {
        try {
          logger.info('Attempting Redis reconnection');
          await this.redis.connect();
          health.redis = true;
        } catch (reconnectError) {
          logger.error('Redis reconnection failed', {
            error: reconnectError instanceof Error ? reconnectError.message : reconnectError
          });
        }
      }
    }
    
    try {
      // Test scan queue with timeout
      await Promise.race([
        this.scanQueue.getWaiting(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Queue operation timeout')), 5000)
        )
      ]);
      health.scanQueue = true;
    } catch (error) {
      logger.error('Scan queue health check failed', {
        error: error instanceof Error ? error.message : error
      });
    }
    
    try {
      // Test dead letter queue with timeout
      await Promise.race([
        this.deadLetterQueue.getWaiting(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Queue operation timeout')), 5000)
        )
      ]);
      health.deadLetterQueue = true;
    } catch (error) {
      logger.error('Dead letter queue health check failed', {
        error: error instanceof Error ? error.message : error
      });
    }
    
    // Check if metrics are being updated
    health.metrics = this.metricsInterval !== null;
    
    return health;
  }

  async close(): Promise<void> {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
    
    logger.info('Closing task queues');
    
    await Promise.all([
      this.scanQueue.close(),
      this.deadLetterQueue.close()
    ]);
    
    this.redis.disconnect();
    
    logger.info('Task queues closed');
  }
}
