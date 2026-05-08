import { Pool, PoolClient } from 'pg';
import type { PoolConfig } from 'pg';
import { appConfig } from './config';
import { Scan, Library, Finding, Script, ScanStatus } from '@shieldeye/shared';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger';
import fs from 'fs';
import { ScanRepository } from './repositories/scan_repository';
import { LibraryRepository, FindingRepository } from './repositories/library_repository';

export class Database {
  private pool: Pool;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private isHealthy: boolean = true;
  private scanRepository!: ScanRepository;
  private libraryRepository!: LibraryRepository;
  private findingRepository!: FindingRepository;
  private deferredFeatureWarningsEmitted: Set<string> = new Set();

  private returnDeferredValue<T>(methodName: string, plannedVersion: string, fallbackValue: T): T {
    if (!this.deferredFeatureWarningsEmitted.has(methodName)) {
      this.deferredFeatureWarningsEmitted.add(methodName);
      logger.debug('Deferred database method called', {
        method: methodName,
        plannedVersion,
        note: 'Returning temporary fallback value',
      });
    }
    return fallbackValue;
  }

  // Fix: avoid `any` when reading error codes from unknown errors.
  private getErrorCode(error: unknown): string | undefined {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const code = (error as { code?: unknown }).code;
      return typeof code === 'string' ? code : undefined;
    }
    return undefined;
  }

  // Fix: centralize CA file loading with explicit error translation for strict-safe diagnostics.
  private loadTlsCaCertificate(caCertPath: string): string {
    try {
      return fs.readFileSync(caCertPath, 'utf8');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read TLS CA certificate from path '${caCertPath}': ${errorMessage}`);
    }
  }

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    const sslConfig = appConfig.tls.enabled
      ? {
          rejectUnauthorized: appConfig.tls.rejectUnauthorized,
          // Fix: keep CA optional and only load when path is provided.
          ca: appConfig.tls.caCertPath ? this.loadTlsCaCertificate(appConfig.tls.caCertPath) : undefined,
          minVersion: appConfig.tls.minVersion
        }
      : undefined;

    // Fix: keep only pg-supported typed options to eliminate PoolConfig type mismatches.
    const poolConfig: PoolConfig = {
      max: parseInt(process.env.DB_MAX_CONNECTIONS || '30'),
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '60000'),
      connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || '10000'),
      statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT || '30000'),
      query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT || '30000'),
      application_name: 'ShieldEye-API',
      ssl: sslConfig,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      allowExitOnIdle: false
    };

    if (connectionString) {
      this.pool = new Pool({
        connectionString,
        ...poolConfig
      });
    } else {
      this.pool = new Pool({
        host: appConfig.database.host,
        port: appConfig.database.port,
        database: appConfig.database.database,
        user: appConfig.database.username,
        password: appConfig.database.password,
        ...poolConfig
      });
    }

    this.setupEventHandlers();
    this.startHealthCheck();
    this.scanRepository = new ScanRepository(this.pool, (operation) => this.withRetry(operation));
    this.libraryRepository = new LibraryRepository(
      this.pool,
      (operation) => this.withRetry(operation),
      (operation) => this.withTransaction(operation),
    );
    this.findingRepository = new FindingRepository(this.pool, (operation) => this.withRetry(operation));
  }

  private setupEventHandlers(): void {
    this.pool.on('connect', (client) => {
      logger.debug('Database client connected', { 
        totalCount: this.pool.totalCount,
        idleCount: this.pool.idleCount,
        waitingCount: this.pool.waitingCount
      });
    });

    this.pool.on('acquire', (client) => {
      logger.debug('Database client acquired', {
        totalCount: this.pool.totalCount,
        idleCount: this.pool.idleCount,
        waitingCount: this.pool.waitingCount
      });
    });

    this.pool.on('error', (err, client) => {
      const errorCode = this.getErrorCode(err);
      logger.error('Database pool error', { 
        error: err.message,
        stack: err.stack,
        code: errorCode,
        totalCount: this.pool.totalCount,
        idleCount: this.pool.idleCount
      });
      this.isHealthy = false;
      
      if (errorCode === 'ECONNREFUSED' || errorCode === 'ETIMEDOUT') {
        logger.warn('Database connection lost, will attempt reconnection on next query');
      }
    });

    this.pool.on('remove', (client) => {
      logger.debug('Database client removed', {
        totalCount: this.pool.totalCount,
        idleCount: this.pool.idleCount
      });
    });
  }

  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.executeWithTimeout(
          () => this.pool.query('SELECT 1'),
          5000,
          'Health check'
        );
        this.isHealthy = true;
      } catch (error) {
        logger.error('Database health check failed', { 
          error: error instanceof Error ? error.message : error 
        });
        this.isHealthy = false;
      }
    }, 30000);
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
        
        const errorCode = this.getErrorCode(lastError);
        const isRetryable = [
          'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET',
          'CONNECTION_TERMINATED', 'CONNECTION_TIMEOUT'
        ].includes(errorCode ?? '') || lastError.message.includes('timeout');
        
        if (attempt === maxAttempts || !isRetryable) {
          if (isRetryable) {
            this.isHealthy = false;
          }
          throw lastError;
        }
        
        logger.warn(`Database operation failed, retrying (${attempt}/${maxAttempts})`, {
          error: lastError.message,
          code: errorCode,
          retryable: isRetryable,
          nextRetryIn: delayMs
        });
        
        await new Promise(resolve => setTimeout(resolve, delayMs));
        delayMs *= 2;
      }
    }
    
    throw lastError!;
  }

  async withTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.withRetry(async () => {
      const client = await this.executeWithTimeout(
        () => this.pool.connect(),
        15000,
        'Database connection acquire'
      );
      
      try {
        await client.query('BEGIN');
        const result = await operation(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          logger.error('Rollback failed', { 
            rollbackError: rollbackError instanceof Error ? rollbackError.message : rollbackError 
          });
        }
        logger.error('Transaction rolled back', { 
          error: error instanceof Error ? error.message : error 
        });
        throw error;
      } finally {
        client.release();
      }
    });
  }

  getPoolStats() {
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
      isHealthy: this.isHealthy
    };
  }

  async ping(): Promise<void> {
    try {
      await this.executeWithTimeout(
        () => this.pool.query('SELECT 1'),
        5000,
        'Ping'
      );
      this.isHealthy = true;
    } catch (error) {
      this.isHealthy = false;
      throw error;
    }
  }

  async initialize(): Promise<void> {
    await this.createTables();
  }

  private async createTables(): Promise<void> {
    await this.withTransaction(async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS scans (
          id UUID PRIMARY KEY,
          url TEXT NOT NULL,
          metadata JSONB NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          started_at TIMESTAMP WITH TIME ZONE,
          completed_at TIMESTAMP WITH TIME ZONE,
          global_risk_score INTEGER DEFAULT 0,
          artifact_paths JSONB DEFAULT '{}',
          error TEXT
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS scripts (
          id UUID PRIMARY KEY,
          scan_id UUID REFERENCES scans(id) ON DELETE CASCADE,
          source_url TEXT,
          is_inline BOOLEAN NOT NULL DEFAULT false,
          artifact_path TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          detected_patterns TEXT[] DEFAULT '{}',
          estimated_version TEXT,
          confidence INTEGER DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS libraries (
          id UUID PRIMARY KEY,
          scan_id UUID REFERENCES scans(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          detected_version TEXT,
          related_scripts TEXT[] DEFAULT '{}',
          vulnerabilities JSONB DEFAULT '[]',
          risk_score INTEGER DEFAULT 0,
          confidence INTEGER DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS findings (
          id UUID PRIMARY KEY,
          scan_id UUID REFERENCES scans(id) ON DELETE CASCADE,
          type VARCHAR(50) NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          severity VARCHAR(20) NOT NULL,
          location JSONB DEFAULT '{}',
          evidence TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS vulnerability_cache (
          id UUID PRIMARY KEY,
          package_name TEXT NOT NULL,
          version TEXT,
          vulnerabilities JSONB NOT NULL,
          last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          ttl INTEGER DEFAULT 86400,
          UNIQUE(package_name, version)
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS ai_analysis (
          scan_id UUID PRIMARY KEY REFERENCES scans(id) ON DELETE CASCADE,
          threat_intelligence JSONB NOT NULL DEFAULT '{}',
          risk_assessment JSONB NOT NULL DEFAULT '{}',
          behavioral_analysis JSONB NOT NULL DEFAULT '{}',
          predictions JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS integrity_reports (
          scan_id UUID REFERENCES scans(id) ON DELETE CASCADE,
          package_name TEXT NOT NULL,
          version TEXT,
          integrity_status TEXT NOT NULL,
          verification_method TEXT NOT NULL,
          confidence INTEGER DEFAULT 0,
          details JSONB DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS supply_chain_analysis (
          scan_id UUID PRIMARY KEY REFERENCES scans(id) ON DELETE CASCADE,
          risk_assessment JSONB NOT NULL DEFAULT '{}',
          recommendations JSONB NOT NULL DEFAULT '[]',
          supply_chain_map JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS quantum_readiness (
          scan_id UUID PRIMARY KEY REFERENCES scans(id) ON DELETE CASCADE,
          overall_readiness TEXT NOT NULL,
          crypto_inventory JSONB NOT NULL DEFAULT '[]',
          threats JSONB NOT NULL DEFAULT '[]',
          migration_plan JSONB NOT NULL DEFAULT '{}',
          timeline JSONB NOT NULL DEFAULT '{}',
          cost_estimate JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS analytics_reports (
          scan_id UUID REFERENCES scans(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          summary JSONB NOT NULL DEFAULT '{}',
          sections JSONB NOT NULL DEFAULT '[]',
          recommendations JSONB NOT NULL DEFAULT '[]',
          charts JSONB NOT NULL DEFAULT '[]'
        )
      `);

      await client.query('CREATE INDEX IF NOT EXISTS idx_scans_status ON scans(status)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_scans_created_at ON scans(created_at)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_scripts_scan_id ON scripts(scan_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_libraries_scan_id ON libraries(scan_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_findings_scan_id ON findings(scan_id)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_vuln_cache_package ON vulnerability_cache(package_name, version)');
    });
  }

  async createScan(scan: Omit<Scan, 'id' | 'createdAt'>): Promise<string> {
    return this.scanRepository.createScan(scan);
  }

  async getScan(id: string): Promise<Scan | null> {
    return this.scanRepository.getScan(id);
  }

  async getRecentScansByUrl(url: string, limit: number): Promise<Scan[]> {
    return this.scanRepository.getRecentScansByUrl(url, limit);
  }

  async updateScanStatus(id: string, status: ScanStatus, error?: string): Promise<void> {
    return this.scanRepository.updateScanStatus(id, status, error);
  }

  async updateScanRiskScore(id: string, riskScore: number): Promise<void> {
    return this.scanRepository.updateScanRiskScore(id, riskScore);
  }

  async listScans(limit: number, offset: number): Promise<{
    items: Scan[];
    total: number;
    limit: number;
    offset: number;
  }> {
    return this.scanRepository.listScans(limit, offset);
  }

  async deleteScan(id: string): Promise<void> {
    return this.scanRepository.deleteScan(id);
  }

  async createLibrary(library: Omit<Library, 'id'>): Promise<string> {
    return this.libraryRepository.createLibrary(library);
  }

  async getLibrariesByScan(scanId: string): Promise<Library[]> {
    return this.libraryRepository.getLibrariesByScan(scanId);
  }

  async createFinding(finding: Omit<Finding, 'id'>): Promise<string> {
    return this.findingRepository.createFinding(finding);
  }

  async getFindingsByScan(scanId: string): Promise<Finding[]> {
    return this.findingRepository.getFindingsByScan(scanId);
  }

  async createScript(script: Omit<Script, 'id'>): Promise<string> {
    return this.withRetry(async () => {
      const id = uuidv4();
      await this.pool.query(
        `INSERT INTO scripts (id, scan_id, source_url, is_inline, artifact_path, fingerprint, detected_patterns, estimated_version, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, script.scanId, script.sourceUrl, script.isInline, script.artifactPath, script.fingerprint, script.detectedPatterns, script.estimatedVersion, script.confidence]
      );
      logger.debug('Script created', { scriptId: id, scanId: script.scanId, sourceUrl: script.sourceUrl });
      return id;
    });
  }

  /**
   * Batch insert scripts to reduce DB round-trips.
   * Returns generated IDs in the same order as the input array.
   */
  async createScriptsBatch(scripts: Array<Omit<Script, 'id'>>): Promise<string[]> {
    if (!scripts || scripts.length === 0) return [];

    return this.withTransaction(async (client) => {
      const ids = scripts.map(() => uuidv4());

      const values: any[] = [];
      const placeholders = scripts
        .map((s, i) => {
          const base = i * 9;
          values.push(
            ids[i],
            s.scanId,
            s.sourceUrl ?? null,
            !!s.isInline,
            s.artifactPath,
            s.fingerprint,
            s.detectedPatterns ?? [],
            s.estimatedVersion ?? null,
            s.confidence ?? 0,
          );
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`;
        })
        .join(', ');

      await client.query(
        `INSERT INTO scripts (id, scan_id, source_url, is_inline, artifact_path, fingerprint, detected_patterns, estimated_version, confidence)
         VALUES ${placeholders}`,
        values,
      );

      logger.debug('Scripts batch created', { count: scripts.length });
      return ids;
    });
  }

  /**
   * Batch insert libraries to reduce DB round-trips.
   * Returns generated IDs in the same order as the input array.
   */
  async createLibrariesBatch(libraries: Array<Omit<Library, 'id'>>): Promise<string[]> {
    return this.libraryRepository.createLibrariesBatch(libraries);
  }

  async getScriptsByScan(scanId: string): Promise<Script[]> {
    return this.withRetry(async () => {
      const result = await this.pool.query('SELECT * FROM scripts WHERE scan_id = $1', [scanId]);
      return result.rows.map((row: any) => ({
        id: row.id,
        scanId: row.scan_id,
        sourceUrl: row.source_url,
        isInline: row.is_inline,
        artifactPath: row.artifact_path,
        fingerprint: row.fingerprint,
        detectedPatterns: row.detected_patterns,
        estimatedVersion: row.estimated_version,
        confidence: row.confidence
      }));
    });
  }

  /**
   * Vulnerability cache helpers for OSV-backed vulnerability data.
   * These are used by the minimal analyzer to avoid hammering the OSV API
   * when the same library/version is scanned repeatedly.
   */
  async getVulnerabilityCacheEntry(
    packageName: string,
    version?: string | null
  ): Promise<{ vulnerabilities: any[]; lastUpdated: Date; ttl: number } | null> {
    return this.withRetry(async () => {
      const result = await this.pool.query(
        `
          SELECT vulnerabilities, last_updated, ttl
          FROM vulnerability_cache
          WHERE package_name = $1
            AND (version IS NOT DISTINCT FROM $2)
        `,
        [packageName, version ?? null]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      const lastUpdated: Date = row.last_updated;
      const ttlSeconds: number = row.ttl ?? 86400;

      // Enforce TTL at the database helper level so callers can treat
      // expired entries the same as a cache miss.
      try {
        const expiresAt = new Date(lastUpdated.getTime() + ttlSeconds * 1000);
        if (Date.now() > expiresAt.getTime()) {
          return null;
        }
      } catch {
        // If parsing fails, fall back to returning the row (caller may handle).
      }

      return {
        vulnerabilities: row.vulnerabilities || [],
        lastUpdated,
        ttl: ttlSeconds
      };
    });
  }

  async upsertVulnerabilityCacheEntry(
    packageName: string,
    version: string | null,
    vulnerabilities: any[],
    ttlSeconds: number
  ): Promise<void> {
    return this.withRetry(async () => {
      await this.pool.query(
        `
          INSERT INTO vulnerability_cache (id, package_name, version, vulnerabilities, last_updated, ttl)
          VALUES ($1, $2, $3, $4, NOW(), $5)
          ON CONFLICT (package_name, version)
          DO UPDATE SET
            vulnerabilities = EXCLUDED.vulnerabilities,
            last_updated   = NOW(),
            ttl            = EXCLUDED.ttl
        `,
        [uuidv4(), packageName, version, JSON.stringify(vulnerabilities), ttlSeconds]
      );
    });
  }

  async getFindingsCountByTypes(types: string[]): Promise<number> {
    return this.findingRepository.getFindingsCountByTypes(types);
  }

  async getLibrary(id: string): Promise<Library | null> {
    return this.libraryRepository.getLibrary(id);
  }

  // Methods planned for a later milestone.
  // For now they return conservative fallback values until the
  // persistence layer for these features is implemented.

  async getRecentScansWithAI(days: number): Promise<any[]> {
    return this.returnDeferredValue('getRecentScansWithAI', 'v1.1', []);
  }

  async getRecentScansWithSupplyChain(days: number): Promise<any[]> {
    return this.returnDeferredValue('getRecentScansWithSupplyChain', 'v1.1', []);
  }

  async getAlerts(filters: any, limit: number, offset: number): Promise<any[]> {
    return this.returnDeferredValue('getAlerts', 'v1.1', []);
  }

  async getAlert(id: string): Promise<any | null> {
    return this.returnDeferredValue('getAlert', 'v1.1', null);
  }

  async acknowledgeAlert(id: string, acknowledgedBy: string): Promise<void> {
    return this.returnDeferredValue('acknowledgeAlert', 'v1.1', undefined);
  }

  async resolveAlert(id: string, resolvedBy: string, resolution: string): Promise<void> {
    return this.returnDeferredValue('resolveAlert', 'v1.1', undefined);
  }

  async getLatestMetrics(targetId: string): Promise<any | null> {
    return this.returnDeferredValue('getLatestMetrics', 'v1.1', null);
  }

  async getMetricsHistory(targetId: string, startTime: Date, interval: string): Promise<any[]> {
    return this.returnDeferredValue('getMetricsHistory', 'v1.1', []);
  }

  async getPredictiveAlerts(type: string, timeframe: string, limit: number): Promise<any[]> {
    return this.returnDeferredValue('getPredictiveAlerts', 'v1.1', []);
  }

  async startMonitoring(targetId: string, targetType: string, config: any): Promise<string> {
    return this.returnDeferredValue('startMonitoring', 'v1.1', 'monitoring-session-id');
  }

  async stopMonitoring(targetId: string): Promise<void> {
    return this.returnDeferredValue('stopMonitoring', 'v1.1', undefined);
  }

  async getMonitoringStatus(targetId: string): Promise<any | null> {
    return this.returnDeferredValue('getMonitoringStatus', 'v1.1', null);
  }

  async getActiveAlerts(): Promise<any[]> {
    return this.returnDeferredValue('getActiveAlerts', 'v1.1', []);
  }

  async getRecentMetrics(timeRange: string): Promise<any[]> {
    return this.returnDeferredValue('getRecentMetrics', 'v1.1', []);
  }

  async getActiveMonitoringSessions(): Promise<any[]> {
    return this.returnDeferredValue('getActiveMonitoringSessions', 'v1.1', []);
  }

  async getAlertTrends(timeRange: string): Promise<any[]> {
    return this.returnDeferredValue('getAlertTrends', 'v1.1', []);
  }

  async getAnalyticsReports(filters: any, limit: number, offset: number): Promise<any[]> {
    return this.returnDeferredValue('getAnalyticsReports', 'v1.1', []);
  }

  async getAnalyticsReport(id: string): Promise<any | null> {
    return this.returnDeferredValue('getAnalyticsReport', 'v1.1', null);
  }

  async saveAnalyticsReport(report: any): Promise<string> {
    return this.returnDeferredValue('saveAnalyticsReport', 'v1.1', 'report-id');
  }

  async getTrends(metric: string, timeRange: string, granularity: string): Promise<any[]> {
    return this.returnDeferredValue('getTrends', 'v1.1', []);
  }

  async getPredictiveAnalysis(timeframe: string, confidence: number, limit: number): Promise<any[]> {
    return this.returnDeferredValue('getPredictiveAnalysis', 'v1.1', []);
  }

  async getFindingsSeverityCounts(): Promise<Record<string, number>> {
    return this.withRetry(async () => {
      const result = await this.pool.query(
        'SELECT severity, COUNT(*)::int AS count FROM findings GROUP BY severity'
      );
      const counts: Record<string, number> = {};
      for (const row of result.rows) {
        counts[row.severity] = row.count;
      }
      return counts;
    });
  }

  async getAverageScanDurationSeconds(): Promise<number> {
    return this.withRetry(async () => {
      const result = await this.pool.query(
        `SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) AS avg_seconds
         FROM scans
         WHERE completed_at IS NOT NULL AND started_at IS NOT NULL`
      );
      const value = result.rows[0]?.avg_seconds;
      return typeof value === 'number' ? value : 0;
    });
  }

  async getScansCount(): Promise<number> {
    return this.withRetry(async () => {
      const result = await this.pool.query('SELECT COUNT(*)::int AS total FROM scans');
      return result.rows[0]?.total || 0;
    });
  }

  async getAverageRiskScore(): Promise<number> {
    return this.withRetry(async () => {
      const result = await this.pool.query(
        'SELECT AVG(global_risk_score)::float AS avg_score FROM scans WHERE global_risk_score IS NOT NULL'
      );
      const value = result.rows[0]?.avg_score;
      return typeof value === 'number' ? value : 0;
    });
  }

  async getLibrariesCount(): Promise<number> {
    return this.withRetry(async () => {
      const result = await this.pool.query('SELECT COUNT(*)::int AS total FROM libraries');
      return result.rows[0]?.total || 0;
    });
  }

  async getTotalFindingsCount(): Promise<number> {
    return this.withRetry(async () => {
      const result = await this.pool.query('SELECT COUNT(*)::int AS total FROM findings');
      return result.rows[0]?.total || 0;
    });
  }

  async getTopVulnerabilities(limit: number = 5): Promise<Array<{ name: string; severity: string; count: number }>> {
    return this.withRetry(async () => {
      const result = await this.pool.query(
        `SELECT title AS name, severity, COUNT(*)::int AS count
         FROM findings
         GROUP BY title, severity
         ORDER BY count DESC
         LIMIT $1`,
        [limit]
      );
      return result.rows || [];
    });
  }

  async getDailyVulnerabilityTrends(
    days: number = 30
  ): Promise<Array<{ date: string; count: number }>> {
    return this.withRetry(async () => {
      const result = await this.pool.query(
        `SELECT
           (date_trunc('day', created_at))::date AS date,
           COUNT(*)::int AS count
         FROM findings
         WHERE created_at >= NOW() - ($1::int || ' days')::interval
         GROUP BY date
         ORDER BY date ASC`,
        [days]
      );

      return result.rows.map((row: any) => ({
        date: row.date.toISOString().slice(0, 10),
        count: row.count,
      }));
    });
  }

  async getDailyScanCounts(
    days: number = 7,
  ): Promise<Array<{ date: string; count: number }>> {
    return this.withRetry(async () => {
      const result = await this.pool.query(
        `SELECT
           (date_trunc('day', created_at))::date AS date,
           COUNT(*)::int AS count
         FROM scans
         WHERE created_at >= NOW() - ($1::int || ' days')::interval
         GROUP BY date
         ORDER BY date ASC`,
        [days],
      );

      return result.rows.map((row: any) => ({
        date: row.date.toISOString().slice(0, 10),
        count: row.count,
      }));
    });
  }

  async close(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    logger.info('Closing database connection pool', {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount
    });
    
    await this.pool.end();
  }
}
