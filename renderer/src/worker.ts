import Queue, { Job } from 'bull';
import Redis from 'ioredis';
import { ScanTask, TaskResult } from '@shieldeye/shared';
import { BrowserManager } from './browser-manager';
import { StorageManager } from './storage';
import { logger } from './logger';
import * as https from 'https';
import * as http from 'http';

export class RenderWorker {
  private queue: import('bull').Queue<ScanTask>;
  private analysisQueue: import('bull').Queue<any>;
  private browserManager: BrowserManager;
  private storageManager: StorageManager;
  private redis: Redis;

  constructor() {
    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD
    };

    this.redis = new Redis(redisConfig);
    
    this.queue = new Queue<ScanTask>('scan-queue', {
      redis: redisConfig,
      defaultJobOptions: {
        removeOnComplete: 10,
        removeOnFail: 50
      }
    });

    // Bull-based analysis queue for consistency and observability
    this.analysisQueue = new Queue<any>('analysis-queue', {
      redis: redisConfig,
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 200,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 }
      }
    });

    this.browserManager = new BrowserManager();
    
    this.storageManager = new StorageManager({
      endpoint: process.env.MINIO_ENDPOINT || 'localhost:9000',
      accessKey: process.env.MINIO_ACCESS_KEY || 'shieldeye',
      secretKey: process.env.MINIO_SECRET_KEY || 'shieldeye_dev',
      bucket: process.env.MINIO_BUCKET || 'shieldeye-artifacts'
    });

    this.setupWorker();
  }

  private setupWorker(): void {
    this.queue.process('scan', 1, async (job: Job<ScanTask>) => {
      return this.processScanJob(job.data, job);
    });

    this.queue.on('completed', (job: Job<ScanTask>, result: TaskResult) => {
      logger.info('Render job completed', { 
        jobId: job.id,
        scanId: result.scanId,
        success: result.success 
      });
    });

    this.queue.on('failed', (job: Job<ScanTask>, err: Error) => {
      logger.error('Render job failed', { 
        jobId: job.id,
        scanId: job.data.scanId,
        error: err.message 
      });
    });
  }

  private isUrlAllowed(rawUrl: string): boolean {
    try {
      const u = new URL(rawUrl);
      if (!/^https?:$/i.test(u.protocol)) return false;
      const host = u.hostname.toLowerCase();
      const allowPriv = (process.env.ALLOW_PRIVATE_NETWORK || 'false').toLowerCase() === 'true';
      if (!allowPriv) {
        if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
        if (/^10\./.test(host)) return false;
        if (/^192\.168\./.test(host)) return false;
        if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
        if (/^169\.254\./.test(host)) return false;
      }
      const allowRegex = process.env.ALLOWLIST_DOMAIN_REGEX;
      if (allowRegex) {
        try { if (!(new RegExp(allowRegex)).test(host)) return false; } catch {}
      }
      return true;
    } catch {
      return false;
    }
  }

  private async withBrowserRetry<T>(fn: () => Promise<T>, retries: number = 1): Promise<T> {
    try {
      return await fn();
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (retries > 0 && /browser|context|page has been closed/i.test(msg)) {
        try {
          await this.browserManager.close();
          await this.browserManager.initialize();
        } catch {}
        return this.withBrowserRetry(fn, retries - 1);
      }
      throw e;
    }
  }

  private async processScanJob(task: ScanTask, job: Job<ScanTask>): Promise<TaskResult> {
    const { scanId, url } = task;

    logger.info('Starting render job', { scanId, url });

    try {
      const parameters: any = (task as any).parameters || {};

      // Normalize options coming from API/GUI (supports both legacy and new shape).
      const timeoutMs =
        (typeof parameters.timeout === 'number' && parameters.timeout > 0 ? parameters.timeout : null) ??
        (typeof parameters.options?.timeout === 'number' && parameters.options.timeout > 0
          ? parameters.options.timeout * 1000
          : 30000);
      const depth =
        (typeof parameters.options?.depth === 'number' ? parameters.options.depth : null) ??
        (typeof parameters.crawlDepth === 'number' ? parameters.crawlDepth : 1);
      const renderJavaScript = parameters.renderJavaScript !== false;
      const userAgent = parameters.userAgent;
      const headers = parameters.headers;

      await job.progress(10);

      // Render + collect DOM analysis (scripts, sourcemaps, resources).
      const sessionId = scanId;
      const domAnalysis =
        depth && depth > 0
          ? await this.browserManager.crawlAndAnalyze(url, sessionId, {
              depth,
              timeout: timeoutMs,
              userAgent,
              headers,
              renderJavaScript,
              maxPages: 10,
              sameOriginOnly: true,
            })
          : await this.browserManager.renderPage(url, sessionId, {
              timeout: timeoutMs,
              waitForNetworkIdle: true,
              userAgent,
              headers,
              renderJavaScript,
            });

      await job.progress(40);

      // Persist a DOM snapshot (useful for debugging / audit trails).
      let domSnapshotPath: string | undefined;
      try {
        const domContent = await this.browserManager.captureDOM(url, sessionId);
        domSnapshotPath = await this.storageManager.uploadDOMSnapshot(scanId, domContent);
      } catch (e) {
        logger.warn('Failed to capture/upload DOM snapshot', {
          scanId,
          url,
          error: e instanceof Error ? e.message : e,
        });
      }

      // Fetch external scripts and upload to MinIO in the path analyzer expects.
      const fetchErrors: any[] = [];
      const uploadedScriptPaths: string[] = [];

      const maxExternalScripts = Math.max(
        0,
        parseInt(process.env.RENDERER_MAX_EXTERNAL_SCRIPTS || '30', 10) || 30
      );
      const externalCount = domAnalysis?.scripts?.external?.length || 0;
      const toFetch = Math.min(externalCount, maxExternalScripts);
      if (externalCount > toFetch) {
        fetchErrors.push({
          type: 'external-script-limit',
          message: `External scripts limited to ${toFetch}/${externalCount}`,
        });
        logger.warn('External scripts limit applied', { scanId, toFetch, externalCount });
      }

      for (let i = 0; i < toFetch; i++) {
        const external = domAnalysis.scripts.external[i];
        const src = external?.src;
        const filename = `external-script-${i + 1}.js`;
        let content = '';
        try {
          if (src) {
            content = await this.fetchTextWithRetry(src, {
              timeoutMs: Math.min(20000, timeoutMs),
              retries: 1,
              headers,
              userAgent,
              referer: url,
            });
          }
        } catch (e) {
          fetchErrors.push({
            type: 'external-script-fetch',
            url: src,
            error: e instanceof Error ? e.message : String(e),
          });
          // Keep going; we'll upload empty content so analyzer can still proceed.
        }

        try {
          const path = await this.storageManager.uploadScript(scanId, content, filename);
          uploadedScriptPaths.push(path);
        } catch (e) {
          fetchErrors.push({
            type: 'external-script-upload',
            url: src,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      await job.progress(70);

      logger.info('Render DOM metrics', {
        scanId,
        inlineScripts: domAnalysis?.scripts?.inline?.length || 0,
        externalScripts: externalCount,
        externalScriptsFetched: uploadedScriptPaths.length,
        maxExternalScripts,
        fetchErrors: fetchErrors.length,
      });

      // Publish analysis task to analyzer (Bull: analysis-queue).
      const analysisTask = {
        scanId,
        artifacts: {
          domSnapshot: domSnapshotPath,
          scripts: uploadedScriptPaths,
        },
        domAnalysis,
        fetchErrors,
        createdAt: new Date(),
      };

      const analysisJob = await this.publishAnalysisTask(analysisTask);

      // Wait for analyzer to finish so this scan's "scan-queue" job represents the full pipeline.
      // This prevents the GUI from showing "completed" before results are persisted.
      await job.progress(85);

      const waitMs = Math.max(30000, timeoutMs) + 120000; // timeout + 2min grace
      await Promise.race([
        analysisJob.finished(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Analysis job timeout')), waitMs)),
      ]);

      await job.progress(100);

      logger.info('Render+analysis pipeline completed', { scanId });

      return {
        scanId,
        success: true,
        artifacts: analysisTask.artifacts,
      };
    } catch (error) {
      logger.error('Render job failed', {
        scanId,
        url,
        error: error instanceof Error ? error.message : error
      });

      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  private async publishAnalysisTask(payload: {
    scanId: string;
    artifacts: any;
    domAnalysis: any;
    fetchErrors: any[];
    createdAt: Date;
  }): Promise<Job<any>> {
    const { scanId } = payload;
    try {
      // Publish to Bull analysis queue
      const job = await this.analysisQueue.add('analyze', payload, {
        jobId: scanId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 }
      });
      
      logger.info('Analysis task published', { scanId });
      return job;
    } catch (error) {
      logger.error('Failed to publish analysis task', { 
        scanId, 
        error: error instanceof Error ? error.message : error 
      });
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  private async fetchTextWithRetry(
    url: string,
    opts: {
      timeoutMs?: number;
      retries?: number;
      maxBytes?: number;
      headers?: Record<string, string>;
      userAgent?: string;
      referer?: string;
    } = {}
  ): Promise<string> {
    const { timeoutMs = 10000, retries = 0, maxBytes = 5 * 1024 * 1024 } = opts;
    let attempt = 0;
    let lastErr: unknown;
    if (!this.isUrlAllowed(url)) {
      throw new Error('External fetch URL not allowed by SSRF policy');
    }
    while (attempt <= retries) {
      try {
        return await this.fetchTextOnce(url, timeoutMs, maxBytes, {
          ...(opts.headers || {}),
          // Prefer plain bodies so we don't store gzipped bytes as "utf-8".
          'Accept-Encoding': 'identity',
          Accept: (opts.headers && (opts.headers['Accept'] || opts.headers['accept'])) || '*/*',
          'User-Agent':
            (opts.headers && (opts.headers['User-Agent'] || opts.headers['user-agent'])) ||
            opts.userAgent ||
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 ShieldEye/1.0',
          ...(opts.referer ? { Referer: opts.referer } : {}),
        });
      } catch (err) {
        lastErr = err;
        attempt += 1;
        if (attempt > retries) break;
        const delay = 500 * attempt;
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  private fetchTextOnce(
    url: string,
    timeoutMs: number,
    maxBytes: number,
    headers: Record<string, string>
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const isHttps = url.startsWith('https:');
        const lib = isHttps ? https : http;
        const controller = new AbortController();
        const timeout = setTimeout(() => {
          controller.abort();
          reject(new Error('Request timed out'));
        }, timeoutMs);

        const req = lib.request(
          url,
          { signal: (controller as any).signal, headers },
          (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            clearTimeout(timeout);
            // follow redirect (keep headers; resolve relative Location)
            let nextUrl = res.headers.location;
            try {
              nextUrl = new URL(nextUrl, url).href;
            } catch {}
            this.fetchTextOnce(nextUrl as string, timeoutMs, maxBytes, headers).then(resolve).catch(reject);
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            clearTimeout(timeout);
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          const contentLengthHeader = res.headers['content-length'];
          if (contentLengthHeader && parseInt(Array.isArray(contentLengthHeader) ? contentLengthHeader[0] : contentLengthHeader, 10) > maxBytes) {
            clearTimeout(timeout);
            reject(new Error('Content too large'));
            return;
          }
          const chunks: Buffer[] = [];
          let total = 0;
          res.on('data', (d) => {
            const buf = Buffer.isBuffer(d) ? d : Buffer.from(d);
            total += buf.length;
            if (total > maxBytes) {
              req.destroy(new Error('Content too large'));
              return;
            }
            chunks.push(buf);
          });
          res.on('end', () => {
            clearTimeout(timeout);
            resolve(Buffer.concat(chunks).toString('utf-8'));
          });
          }
        );
        req.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
        req.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  async initialize(): Promise<void> {
    await this.storageManager.initialize();
    await this.browserManager.initialize();
    logger.info('Render worker initialized');
  }

  async shutdown(): Promise<void> {
    logger.info('Shutting down render worker...');

    await this.queue.close();
    await this.analysisQueue.close();
    this.redis.disconnect();
    await this.browserManager.close();

    logger.info('Render worker shutdown complete');
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
