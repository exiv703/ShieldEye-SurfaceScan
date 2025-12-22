import { Request, Response, NextFunction } from 'express';
import { logger } from './logger';

class SimpleCache {
  private cache = new Map<string, { data: any; expires: number }>();
  private maxSize = 1000;
  
  set(key: string, value: any, ttlMs: number = 300000) {
    if (this.cache.size >= this.maxSize) {
      this.cleanup();
    }
    
    this.cache.set(key, {
      data: value,
      expires: Date.now() + ttlMs
    });
  }
  
  get(key: string): any | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return undefined;
    }
    
    return entry.data;
  }
  
  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expires) {
        this.cache.delete(key);
      }
    }
  }
}

const responseCache = new SimpleCache();

const pendingRequests = new Map<string, Promise<any>>();

export function cacheMiddleware(ttlSeconds: number = 300) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') {
      return next();
    }

    const skipCache =
      ['/health', '/ready', '/live', '/metrics'].some((path) => req.path.startsWith(path)) ||
      req.path.endsWith('/status') ||
      req.path.endsWith('/results') ||
      req.path.endsWith('/surface');
    
    if (skipCache) {
      return next();
    }

    const ttlMs = ttlSeconds * 1000;
    const cacheKey = `${req.method}:${req.originalUrl}`;
    const cached = responseCache.get(cacheKey);

    if (cached) {
      res.set({
        'X-Cache': 'HIT',
        'Cache-Control': `public, max-age=${ttlSeconds}`
      });
      return res.json(cached);
    }

    const originalJson = res.json.bind(res);
    res.json = function(body: any) {
      if (res.statusCode === 200) {
        responseCache.set(cacheKey, body, ttlMs);
        res.set({
          'X-Cache': 'MISS',
          'Cache-Control': `public, max-age=${ttlSeconds}`
        });
      }
      return originalJson(body);
    };

    next();
  };
}

export function deduplicationMiddleware() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') {
      return next();
    }

    const requestKey = `${req.method}:${req.originalUrl}:${req.ip}`;
    
    if (pendingRequests.has(requestKey)) {
      try {
        const result = await pendingRequests.get(requestKey);
        res.set('X-Deduplicated', 'true');
        return res.json(result);
      } catch (error) {
        logger.warn('Request deduplication failed', { 
          requestKey, 
          error: error instanceof Error ? error.message : error 
        });
      }
    }

    const originalJson = res.json.bind(res);
    let responseData: any;
    
    res.json = function(body: any) {
      responseData = body;
      return originalJson(body);
    };

    // Create a promise for this request
    const requestPromise = new Promise((resolve, reject) => {
      res.on('finish', () => {
        if (res.statusCode === 200 && responseData) {
          resolve(responseData);
        } else {
          reject(new Error(`Request failed with status ${res.statusCode}`));
        }
        setTimeout(() => pendingRequests.delete(requestKey), 1000);
      });

      res.on('error', (error) => {
        reject(error);
        pendingRequests.delete(requestKey);
      });
    });

    pendingRequests.set(requestKey, requestPromise);

    requestPromise.catch((error) => {
      logger.debug('Deduplicated request promise rejected', {
        requestKey,
        error: error instanceof Error ? error.message : error
      });
    });
    next();
  };
}

export function compressionMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);
    
    res.json = function(body: any) {
      const bodyString = JSON.stringify(body);
      
      if (bodyString.length > 1024) {
        res.set({
          'Content-Encoding': 'gzip',
          'Vary': 'Accept-Encoding'
        });
      }
      
      return originalJson(body);
    };

    next();
  };
}

export function performanceMonitoring() {
  const slowRequests = new Map<string, number>();
  
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    const requestKey = `${req.method} ${req.path}`;
    
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      
      if (duration > 1000) {
        const count = slowRequests.get(requestKey) || 0;
        slowRequests.set(requestKey, count + 1);
        
        logger.warn('Slow request detected', {
          method: req.method,
          path: req.path,
          duration,
          count: count + 1,
          ip: req.ip,
          userAgent: req.get('User-Agent')
        });
      }
      
      if (Math.random() < 0.01) {
        for (const [key, count] of slowRequests.entries()) {
          if (count < 5) {
            slowRequests.delete(key);
          }
        }
      }
    });
    
    next();
  };
}

// Circuit breaker pattern for external services
export class CircuitBreaker {
  private failures: number = 0;
  private lastFailureTime: number = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  
  constructor(
    private failureThreshold: number = 5,
    private recoveryTimeout: number = 60000 // 1 minute
  ) {}
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.recoveryTimeout) {
        this.state = 'HALF_OPEN';
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
  }
  
  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
    
    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }
  
  getState() {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime
    };
  }
}
