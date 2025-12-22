import { register, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';
import { Request, Response, NextFunction } from 'express';
import { logger } from './logger';

collectDefaultMetrics({ register });
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10],
  registers: [register]
});

export const activeConnections = new Gauge({
  name: 'active_connections_total',
  help: 'Number of active database connections',
  registers: [register]
});

export const queueSize = new Gauge({
  name: 'queue_size_total',
  help: 'Number of jobs in queue',
  labelNames: ['queue_name', 'status'],
  registers: [register]
});

export const scanMetrics = {
  scansTotal: new Counter({
    name: 'scans_total',
    help: 'Total number of scans performed',
    labelNames: ['status', 'scan_type'],
    registers: [register]
  }),
  
  scanDuration: new Histogram({
    name: 'scan_duration_seconds',
    help: 'Duration of scans in seconds',
    labelNames: ['scan_type'],
    buckets: [1, 5, 10, 30, 60, 300, 600, 1800],
    registers: [register]
  }),
  
  vulnerabilitiesFound: new Counter({
    name: 'vulnerabilities_found_total',
    help: 'Total number of vulnerabilities found',
    labelNames: ['severity', 'scan_type'],
    registers: [register]
  }),
  
  aiAnalysisRequests: new Counter({
    name: 'ai_analysis_requests_total',
    help: 'Total number of AI analysis requests',
    labelNames: ['status', 'analysis_type'],
    registers: [register]
  }),
  
  blockchainVerifications: new Counter({
    name: 'blockchain_verifications_total',
    help: 'Total number of blockchain verifications',
    labelNames: ['status', 'verification_type'],
    registers: [register]
  })
};

export const systemMetrics = {
  memoryUsage: new Gauge({
    name: 'nodejs_memory_usage_bytes',
    help: 'Node.js memory usage in bytes',
    labelNames: ['type'],
    registers: [register]
  }),
  
  cpuUsage: new Gauge({
    name: 'nodejs_cpu_usage_percent',
    help: 'Node.js CPU usage percentage',
    registers: [register]
  }),
  
  diskUsage: new Gauge({
    name: 'disk_usage_bytes',
    help: 'Disk usage in bytes',
    labelNames: ['mount_point', 'type'],
    registers: [register]
  })
};

export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route?.path || req.path;
    const method = req.method;
    const statusCode = res.statusCode.toString();
    
    httpRequestsTotal.inc({ method, route, status_code: statusCode });
    httpRequestDuration.observe({ method, route, status_code: statusCode }, duration);
    
    logger.debug('HTTP request metrics recorded', {
      method,
      route,
      statusCode,
      duration,
      requestId: req.id
    });
  });
  
  next();
};

export const updateSystemMetrics = () => {
  const memUsage = process.memoryUsage();
  systemMetrics.memoryUsage.set({ type: 'rss' }, memUsage.rss);
  systemMetrics.memoryUsage.set({ type: 'heapTotal' }, memUsage.heapTotal);
  systemMetrics.memoryUsage.set({ type: 'heapUsed' }, memUsage.heapUsed);
  systemMetrics.memoryUsage.set({ type: 'external' }, memUsage.external);
  
  // CPU usage calculation (simplified)
  const cpuUsage = process.cpuUsage();
  const totalUsage = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to seconds
  systemMetrics.cpuUsage.set(totalUsage);
};

setInterval(updateSystemMetrics, 15000);

export const getMetrics = async (req: Request, res: Response) => {
  try {
    res.set('Content-Type', register.contentType);
    const metrics = await register.metrics();
    res.end(metrics);
  } catch (error) {
    logger.error('Failed to generate metrics', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to generate metrics' });
  }
};

export const recordScanMetric = (scanType: string, status: 'success' | 'failed', duration: number) => {
  scanMetrics.scansTotal.inc({ status, scan_type: scanType });
  scanMetrics.scanDuration.observe({ scan_type: scanType }, duration);
};

export const recordVulnerability = (severity: string, scanType: string) => {
  scanMetrics.vulnerabilitiesFound.inc({ severity, scan_type: scanType });
};

export const recordAIAnalysis = (analysisType: string, status: 'success' | 'failed') => {
  scanMetrics.aiAnalysisRequests.inc({ status, analysis_type: analysisType });
};

export const recordBlockchainVerification = (verificationType: string, status: 'success' | 'failed') => {
  scanMetrics.blockchainVerifications.inc({ status, verification_type: verificationType });
};

export const updateQueueMetrics = (queueName: string, waiting: number, active: number, completed: number, failed: number) => {
  queueSize.set({ queue_name: queueName, status: 'waiting' }, waiting);
  queueSize.set({ queue_name: queueName, status: 'active' }, active);
  queueSize.set({ queue_name: queueName, status: 'completed' }, completed);
  queueSize.set({ queue_name: queueName, status: 'failed' }, failed);
};

export const updateDatabaseMetrics = (activeConns: number) => {
  activeConnections.set(activeConns);
};

export { register };
