import Redis from 'ioredis';
import Queue, { Job } from 'bull';
import { Client } from 'minio';
import { Pool } from 'pg';
import { LibraryDetector } from './fingerprinting/library-detector';
import { VulnerabilityFeedClient } from './vulnerability/feed-client';
import { 
  FindingType, 
  RiskLevel, 
  Library, 
  Finding, 
  Script
} from '@shieldeye/shared';
import { logger } from './logger';
import { EventEmitter } from 'events';
import { AIThreatIntelligenceEngine } from './ai/threat-intelligence';
import { BlockchainIntegrityVerifier } from './blockchain/integrity-verifier';
import { RealTimeMonitoringSystem } from './monitoring/realtime-monitor';
import { AdvancedAnalyticsEngine } from './reporting/advanced-analytics';
import { QuantumCryptoAnalyzer } from './quantum/crypto-analyzer';
import { ScanService } from './services/scan_service';
import { AnalysisEngine } from './services/analysis_engine';
import { ResultPersister } from './services/result_persister';

export class AnalysisWorker extends EventEmitter {
  private redis: Redis;
  private minio: Client;
  private database: Pool;
  private analysisQueue!: import('bull').Queue<any>;
  private libraryDetector: LibraryDetector;
  private vulnerabilityClient: VulnerabilityFeedClient;
  private aiEngine: AIThreatIntelligenceEngine;
  private blockchainVerifier: BlockchainIntegrityVerifier;
  private monitoringSystem: RealTimeMonitoringSystem;
  private analyticsEngine: AdvancedAnalyticsEngine;
  private quantumAnalyzer: QuantumCryptoAnalyzer;
  private scanService!: ScanService;
  private analysisEngineService!: AnalysisEngine;
  private resultPersister!: ResultPersister;
  private isRunning: boolean = false;
  private processingTasks: Set<string> = new Set();
  private maxConcurrentTasks: number = 3;
  private taskTimeouts: Map<string, NodeJS.Timeout> = new Map();

  private resolveMinioUseSsl(endpoint: string): boolean {
    const explicit = (process.env.MINIO_USE_SSL || '').trim().toLowerCase();
    if (explicit === 'true') return true;
    if (explicit === 'false') return false;

    // Conservative fallback: infer TLS for standard secure ports.
    return endpoint.endsWith(':443') || endpoint.endsWith(':9443');
  }

  constructor() {
    super();

    // Initialize advanced engines first
    this.aiEngine = new AIThreatIntelligenceEngine();
    this.blockchainVerifier = new BlockchainIntegrityVerifier();
    this.monitoringSystem = new RealTimeMonitoringSystem(
      this.aiEngine,
      this.blockchainVerifier,
      8080
    );
    this.analyticsEngine = new AdvancedAnalyticsEngine(
      this.aiEngine,
      this.blockchainVerifier
    );
    this.quantumAnalyzer = new QuantumCryptoAnalyzer();

    this.setupEventHandlers();

    // Initialize Redis
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD
    });

    // Initialize MinIO
    const minioEndpoint = process.env.MINIO_ENDPOINT || 'localhost:9000';
    const minioUseSsl = this.resolveMinioUseSsl(minioEndpoint);
    this.minio = new Client({
      endPoint: minioEndpoint.split(':')[0],
      port: parseInt(minioEndpoint.split(':')[1]) || 9000,
      useSSL: minioUseSsl,
      accessKey: process.env.MINIO_ACCESS_KEY || 'shieldeye',
      secretKey: process.env.MINIO_SECRET_KEY || 'shieldeye_dev'
    });

    if (!minioUseSsl && process.env.NODE_ENV === 'production') {
      logger.warn('MinIO TLS is disabled in production mode. Set MINIO_USE_SSL=true for secure transport.');
    }

    // Initialize Database (supports DATABASE_URL or DB_* vars)
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl) {
      this.database = new Pool({ connectionString: databaseUrl });
    } else {
      this.database = new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'shieldeye',
        user: process.env.DB_USER || 'shieldeye',
        password: process.env.DB_PASSWORD || 'shieldeye_dev'
      });
    }

    // Initialize services
    this.libraryDetector = new LibraryDetector();
    this.vulnerabilityClient = new VulnerabilityFeedClient({
      osv: {
        baseUrl: process.env.OSV_API_URL || 'https://api.osv.dev',
        timeout: parseInt(process.env.OSV_TIMEOUT || '30000')
      },
      nvd: {
        baseUrl: process.env.NVD_API_URL || 'https://services.nvd.nist.gov/rest/json',
        apiKey: process.env.NVD_API_KEY,
        timeout: parseInt(process.env.NVD_TIMEOUT || '30000')
      }
    });

    this.resultPersister = new ResultPersister(this.database);
    this.analysisEngineService = new AnalysisEngine({
      libraryDetector: this.libraryDetector,
      vulnerabilityClient: this.vulnerabilityClient,
      aiEngine: this.aiEngine,
      blockchainVerifier: this.blockchainVerifier,
      quantumAnalyzer: this.quantumAnalyzer,
      analyticsEngine: this.analyticsEngine,
      readObjectAsString: (bucket: string, objectName: string) => this.readObjectAsString(bucket, objectName),
      generateScriptFingerprint: (content: string) => this.generateScriptFingerprint(content),
      getFindingTitle: (type: FindingType) => this.getFindingTitle(type),
      getFindingDescription: (type: FindingType, evidence: string) => this.getFindingDescription(type, evidence),
      getFindingSeverity: (type: FindingType) => this.getFindingSeverity(type),
    });
    this.scanService = new ScanService({
      analysisEngine: this.analysisEngineService,
      resultPersister: this.resultPersister,
      withRetry: <T>(operation: () => Promise<T>, maxAttempts?: number, delayMs?: number) =>
        this.withRetry(operation, maxAttempts, delayMs),
      updateScanStatus: (scanId: string, status: string, error?: string) =>
        this.updateScanStatus(scanId, status, error),
    });
  }

  private setupEventHandlers(): void {
    // AI Engine events
    this.aiEngine.on('analysisComplete', (result: any) => {
      logger.info('AI analysis completed', { threatScore: result.riskAssessment.overallRisk });
      this.emit('aiAnalysisComplete', result);
    });

    // Blockchain events
    this.blockchainVerifier.on('integrityVerified', (report: any) => {
      logger.info('Integrity verification completed', { 
        package: report.packageName, 
        status: report.integrityStatus 
      });
      this.emit('integrityVerified', report);
    });

    // Monitoring events
    this.monitoringSystem.on('alertCreated', (alert: any) => {
      logger.warn('Security alert created', { 
        type: alert.type, 
        severity: alert.severity,
        title: alert.title 
      });
      this.emit('securityAlert', alert);
    });

    // Analytics events
    this.analyticsEngine.on('reportGenerated', (report: any) => {
      logger.info('Analytics report generated', { 
        type: report.type, 
        id: report.id 
      });
      this.emit('reportGenerated', report);
    });

    // Quantum analyzer events
    this.quantumAnalyzer.on('quantumAnalysisComplete', (report: any) => {
      logger.info('Quantum readiness analysis completed', { 
        readiness: report.overallReadiness 
      });
      this.emit('quantumAnalysisComplete', report);
    });
  }

  async start(): Promise<void> {
    this.isRunning = true;
    logger.info('Enhanced analysis worker started', {
      maxConcurrentTasks: this.maxConcurrentTasks,
      pid: process.pid
    });

    // Bull-based consumer for analysis-queue (preferred, primary)
    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD
    };
    this.analysisQueue = new Queue<any>('analysis-queue', { redis: redisConfig });
    this.analysisQueue.process('analyze', this.maxConcurrentTasks, async (job: Job<any>) => {
      await this.processTaskWithSafeguards(job.data, `bull-${job.id}`, job);
    });
    this.analysisQueue.on('active', (job: Job<any>) => {
      logger.info('Analyzer Bull job active', { jobId: job.id, scanId: job.data?.scanId });
    });
    this.analysisQueue.on('completed', (job: Job<any>) => {
      logger.info('Analyzer Bull job completed', { jobId: job.id, scanId: job.data?.scanId });
    });
    this.analysisQueue.on('failed', (job: Job<any>, err: Error) => {
      logger.error('Analyzer Bull job failed', { jobId: job.id, scanId: job.data?.scanId, error: err.message });
    });

    // Optionally keep legacy BRPOP loop for compatibility (disabled by default).
    // This can be enabled via ENABLE_LEGACY_ANALYSIS_CONSUMER=true if an
    // environment still pushes tasks directly to the Redis list `analysis-queue`.
    const enableLegacy = (process.env.ENABLE_LEGACY_ANALYSIS_CONSUMER || 'false').toLowerCase() === 'true';
    if (enableLegacy) {
      logger.warn('Legacy BRPOP analysis-queue consumer ENABLED (compat mode). Bull + BRPOP will both consume tasks.');
      for (let i = 0; i < this.maxConcurrentTasks; i++) {
        this.startTaskProcessor(`processor-${i}`);
      }
    } else {
      logger.info('Legacy BRPOP analysis-queue consumer DISABLED. Using Bull-only for analysis tasks.');
    }
  }

  private async startTaskProcessor(processorId: string): Promise<void> {
    while (this.isRunning) {
      try {
        // Use blocking pop with timeout for efficient queue polling
        const taskData = await this.redis.brpop('analysis-queue', 5);
        
        if (taskData && taskData[1]) {
          const task = JSON.parse(taskData[1]);
          
          // Validate task structure
          if (!this.validateTask(task)) {
            logger.error('Invalid task structure', { processorId, task });
            continue;
          }

          // Check if we're already processing this scan
          if (this.processingTasks.has(task.scanId)) {
            logger.warn('Task already being processed', { 
              processorId, 
              scanId: task.scanId 
            });
            // Put task back in queue for later processing
            await this.redis.lpush('analysis-queue', JSON.stringify(task));
            continue;
          }

          // Process task with timeout and error handling
          await this.processTaskWithSafeguards(task, processorId);
        }
      } catch (error) {
        logger.error('Error in task processor', { 
          processorId,
          error: error instanceof Error ? error.message : error 
        });
        
        // Exponential backoff on errors
        const backoffMs = Math.min(30000, 1000 * Math.pow(2, Math.random() * 3));
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
  }

  private validateTask(task: any): boolean {
    return task && 
           typeof task.scanId === 'string' && 
           task.scanId.length > 0 &&
           task.artifacts &&
           task.domAnalysis;
  }

  private async processTaskWithSafeguards(task: any, processorId: string, job?: Job<any>): Promise<void> {
    const { scanId } = task;
    
    // Mark task as being processed
    this.processingTasks.add(scanId);
    
    // Set task timeout
    const taskTimeout = setTimeout(() => {
      logger.error('Task processing timeout', { scanId, processorId });
      this.processingTasks.delete(scanId);
      this.updateScanStatus(scanId, 'failed', 'Processing timeout').catch(err => 
        logger.error('Failed to update scan status after timeout', { scanId, error: err })
      );
    }, 600000); // 10 minutes timeout
    
    this.taskTimeouts.set(scanId, taskTimeout);

    try {
      // Update progress to 85% when analysis starts
      if (job) await job.progress(85);
      
      await this.processAnalysisTask(task);
      
      // Update progress to 95% when saving results
      if (job) await job.progress(95);
    } catch (error) {
      logger.error('Task processing failed', {
        scanId,
        processorId,
        error: error instanceof Error ? error.message : error
      });
      
      // Update scan status to failed
      await this.updateScanStatus(
        scanId, 
        'failed', 
        error instanceof Error ? error.message : 'Unknown error'
      );
    } finally {
      // Clean up
      this.processingTasks.delete(scanId);
      const timeout = this.taskTimeouts.get(scanId);
      if (timeout) {
        clearTimeout(timeout);
        this.taskTimeouts.delete(scanId);
      }
    }
  }

  private async processAnalysisTask(task: any): Promise<void> {
    await this.scanService.processAnalysisTask(task);
  }

  private async saveEnhancedAnalysisResults(
    scanId: string,
    scripts: Script[],
    libraries: Library[],
    findings: Finding[],
    globalRiskScore: number,
    aiAnalysis: any,
    integrityReports: any[],
    supplyChainAnalysis: any,
    quantumReadiness: any,
    analyticsReport: any
  ): Promise<void> {
    await this.resultPersister.saveEnhancedAnalysisResults(
      scanId,
      scripts,
      libraries,
      findings,
      globalRiskScore,
      aiAnalysis,
      integrityReports,
      supplyChainAnalysis,
      quantumReadiness,
      analyticsReport,
    );
  }

  private async saveAnalysisResults(
    scanId: string,
    scripts: Script[],
    libraries: Library[],
    findings: Finding[],
    globalRiskScore: number
  ): Promise<void> {
    const client = await this.database.connect();
    
    try {
      await client.query('BEGIN');

      // Save scripts
      for (const script of scripts) {
        await client.query(
          `INSERT INTO scripts (id, scan_id, source_url, is_inline, artifact_path, fingerprint, detected_patterns, estimated_version, confidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [script.id, script.scanId, script.sourceUrl, script.isInline, script.artifactPath, 
           script.fingerprint, script.detectedPatterns, script.estimatedVersion, script.confidence]
        );
      }

      // Save libraries
      for (const library of libraries) {
        await client.query(
          `INSERT INTO libraries (id, scan_id, name, detected_version, related_scripts, vulnerabilities, risk_score, confidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [library.id, library.scanId, library.name, library.detectedVersion, 
           library.relatedScripts, JSON.stringify(library.vulnerabilities), library.riskScore, library.confidence]
        );
      }

      // Save findings
      for (const finding of findings) {
        await client.query(
          `INSERT INTO findings (id, scan_id, type, title, description, severity, location, evidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [finding.id, finding.scanId, finding.type, finding.title, finding.description,
           finding.severity, JSON.stringify(finding.location), finding.evidence]
        );
      }

      // Update scan with global risk score
      await client.query(
        'UPDATE scans SET global_risk_score = $1 WHERE id = $2',
        [Math.round(globalRiskScore), scanId]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async updateScanStatus(scanId: string, status: string, error?: string): Promise<void> {
    const client = await this.database.connect();
    try {
      const now = new Date();
      let query = 'UPDATE scans SET status = $1';
      const params: any[] = [status];
      
      if (status === 'running') {
        query += ', started_at = $2';
        params.push(now);
      } else if (status === 'completed' || status === 'failed') {
        query += ', completed_at = $2';
        params.push(now);
      }
      
      if (error) {
        query += `, error = $${params.length + 1}`;
        params.push(error);
      }
      
      query += ` WHERE id = $${params.length + 1}`;
      params.push(scanId);
      
      await client.query(query, params);
    } finally {
      client.release();
    }
  }

  private generateScriptFingerprint(content: string): string {
    // Simple hash-based fingerprint
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  private getFindingTitle(type: FindingType): string {
    // Use Partial<> because shared FindingType enum may include types
    // that are not produced by the full analyzer.
    const titles: Partial<Record<FindingType, string>> = {
      [FindingType.CVE]: 'Known Vulnerability',
      [FindingType.EVAL_USAGE]: 'Dangerous eval() Usage',
      [FindingType.HARDCODED_TOKEN]: 'Hardcoded Secret/Token',
      [FindingType.DYNAMIC_IMPORT]: 'Dynamic Import Usage',
      [FindingType.REMOTE_CODE]: 'Remote Code Loading',
      [FindingType.WEBASSEMBLY]: 'WebAssembly Usage',
      [FindingType.AI_THREAT]: 'AI-Detected Threat',
      [FindingType.BLOCKCHAIN_INTEGRITY]: 'Blockchain Integrity Issue',
      [FindingType.SUPPLY_CHAIN_ATTACK]: 'Supply Chain Attack',
      [FindingType.QUANTUM_VULNERABILITY]: 'Quantum Vulnerability',
      [FindingType.BEHAVIORAL_ANOMALY]: 'Behavioral Anomaly'
    };
    return titles[type] || 'Security Finding';
  }

  private getFindingDescription(type: FindingType, evidence: string): string {
    const descriptions: Partial<Record<FindingType, string>> = {
      [FindingType.CVE]: 'Known vulnerability identified (CVE). Remediation: upgrade to the nearest fixed version and verify exploitability against your runtime path.',
      [FindingType.EVAL_USAGE]: 'Use of eval() detected; this can enable code injection. Remediation: replace with explicit parsing/dispatch logic and reject untrusted input.',
      [FindingType.HARDCODED_TOKEN]: 'Potential hardcoded secret/token found. Remediation: rotate the credential and move secret loading to environment or secret manager.',
      [FindingType.DYNAMIC_IMPORT]: 'Dynamic import usage detected and may load untrusted code. Remediation: allowlist import targets and enforce integrity/version pinning.',
      [FindingType.REMOTE_CODE]: 'Remote code loading behavior detected. Remediation: pin trusted origins, add SRI for scripts, and block dynamic remote execution paths.',
      [FindingType.WEBASSEMBLY]: 'WebAssembly usage detected and may bypass expected controls. Remediation: restrict wasm sources in CSP and review binary provenance.',
      [FindingType.AI_THREAT]: 'AI-assisted analysis flagged suspicious behavior. Remediation: validate prompt boundaries, output handling, and data-exfiltration guards.',
      [FindingType.BLOCKCHAIN_INTEGRITY]: 'Integrity verification reported package mismatch. Remediation: re-verify artifact provenance and block deployment until signatures/checksums align.',
      [FindingType.SUPPLY_CHAIN_ATTACK]: 'Supply-chain attack indicators detected. Remediation: freeze dependency versions, review transitive graph changes, and quarantine affected package lines.',
      [FindingType.QUANTUM_VULNERABILITY]: 'Quantum-vulnerable cryptographic primitive detected. Remediation: plan migration to modern/post-quantum-safe options for long-lived sensitive data.',
      [FindingType.BEHAVIORAL_ANOMALY]: 'Behavioral anomaly detected. Remediation: correlate with baseline telemetry and add targeted runtime controls before next release.'
    };
    return descriptions[type] || `Security issue detected: ${evidence}`;
  }

  private getFindingSeverity(type: FindingType): RiskLevel {
    const severities: Partial<Record<FindingType, RiskLevel>> = {
      [FindingType.CVE]: RiskLevel.HIGH,
      [FindingType.EVAL_USAGE]: RiskLevel.HIGH,
      [FindingType.HARDCODED_TOKEN]: RiskLevel.CRITICAL,
      [FindingType.DYNAMIC_IMPORT]: RiskLevel.MODERATE,
      [FindingType.REMOTE_CODE]: RiskLevel.CRITICAL,
      [FindingType.WEBASSEMBLY]: RiskLevel.MODERATE,
      [FindingType.AI_THREAT]: RiskLevel.HIGH,
      [FindingType.BLOCKCHAIN_INTEGRITY]: RiskLevel.CRITICAL,
      [FindingType.SUPPLY_CHAIN_ATTACK]: RiskLevel.CRITICAL,
      [FindingType.QUANTUM_VULNERABILITY]: RiskLevel.HIGH,
      [FindingType.BEHAVIORAL_ANOMALY]: RiskLevel.MODERATE
    };
    return severities[type] || RiskLevel.LOW;
  }

  private async readObjectAsString(bucket: string, objectName: string): Promise<string> {
    const stream = await this.minio.getObject(bucket, objectName);
    const chunks: Buffer[] = [];
    return new Promise<string>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        try {
          resolve(Buffer.concat(chunks).toString('utf-8'));
        } catch (err) {
          reject(err);
        }
      });
      stream.on('error', reject);
    });
  }

  private async withRetry<T>(
    operation: () => Promise<T>,
    maxAttempts: number = 3,
    delayMs: number = 1000
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt === maxAttempts) {
          throw lastError;
        }
        
        logger.warn(`Operation failed, retrying (${attempt}/${maxAttempts})`, {
          error: lastError.message,
          nextRetryIn: delayMs
        });
        
        await new Promise(resolve => setTimeout(resolve, delayMs));
        delayMs *= 2; // Exponential backoff
      }
    }
    
    throw lastError!;
  }

  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    operationName: string
  ): Promise<T> {
    return Promise.race([
      operation(),
      new Promise<T>((_, reject) => 
        setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs)
      )
    ]);
  }

  private async batchProcess<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    batchSize: number = 5
  ): Promise<R[]> {
    const results: R[] = [];
    
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(item => processor(item).catch(error => {
          logger.warn('Batch item processing failed', { 
            item: JSON.stringify(item).substring(0, 100),
            error: error instanceof Error ? error.message : error 
          });
          return null;
        }))
      );
      
      results.push(...batchResults.filter(result => result !== null) as R[]);
    }
    
    return results;
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    
    // Clear all pending timeouts
    for (const timeout of this.taskTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.taskTimeouts.clear();
    
    // Wait for current tasks to complete (with timeout)
    const maxWaitTime = 30000; // 30 seconds
    const startTime = Date.now();
    
    while (this.processingTasks.size > 0 && (Date.now() - startTime) < maxWaitTime) {
      logger.info(`Waiting for ${this.processingTasks.size} tasks to complete...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (this.processingTasks.size > 0) {
      logger.warn(`Forcefully stopping with ${this.processingTasks.size} tasks still processing`);
    }
    
    await this.redis.disconnect();
    await this.database.end();
    logger.info('Analysis worker stopped');
  }
}
