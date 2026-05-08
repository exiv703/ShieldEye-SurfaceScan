/**
 * Dependency diagram:
 * Database -> ScanRepository -> pg.Pool
 */
import { v4 as uuidv4 } from 'uuid';
import type { Pool } from 'pg';
import { ScanStatus, type Scan } from '@shieldeye/shared';
import { logger } from '../logger';

export type RetryOperation = <T>(operation: () => Promise<T>) => Promise<T>;

export class ScanRepository {
  constructor(
    private readonly pool: Pool,
    private readonly withRetry: RetryOperation,
  ) {}

  async createScan(scan: Omit<Scan, 'id' | 'createdAt'>): Promise<string> {
    return this.withRetry(async () => {
      const id = uuidv4();
      await this.pool.query(
        `INSERT INTO scans (id, url, metadata, status, global_risk_score, artifact_paths, error)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          scan.url,
          JSON.stringify(scan.parameters),
          scan.status,
          scan.globalRiskScore,
          JSON.stringify(scan.artifactPaths),
          scan.error,
        ],
      );
      logger.debug('Scan created', { scanId: id, url: scan.url });
      return id;
    });
  }

  async getScan(id: string): Promise<Scan | null> {
    return this.withRetry(async () => {
      const result = await this.pool.query('SELECT * FROM scans WHERE id = $1', [id]);
      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      return {
        id: row.id,
        url: row.url,
        parameters: row.metadata,
        status: row.status as ScanStatus,
        createdAt: row.created_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        globalRiskScore: row.global_risk_score,
        artifactPaths: row.artifact_paths,
        error: row.error,
      };
    });
  }

  async getRecentScansByUrl(url: string, limit: number): Promise<Scan[]> {
    return this.withRetry(async () => {
      const result = await this.pool.query(
        'SELECT * FROM scans WHERE url = $1 ORDER BY created_at DESC LIMIT $2',
        [url, limit],
      );

      return result.rows.map((row: any) => ({
        id: row.id,
        url: row.url,
        parameters: row.metadata,
        status: row.status as ScanStatus,
        createdAt: row.created_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        globalRiskScore: row.global_risk_score,
        artifactPaths: row.artifact_paths,
        error: row.error,
      }));
    });
  }

  async updateScanStatus(id: string, status: ScanStatus, error?: string): Promise<void> {
    return this.withRetry(async () => {
      const now = new Date();
      let query = 'UPDATE scans SET status = $1';
      const params: any[] = [status];

      if (status === ScanStatus.RUNNING) {
        query += ', started_at = $2';
        params.push(now);
      } else if (status === ScanStatus.COMPLETED || status === ScanStatus.FAILED) {
        query += ', completed_at = $2';
        params.push(now);
      }

      if (error) {
        query += `, error = $${params.length + 1}`;
        params.push(error);
      }

      query += ` WHERE id = $${params.length + 1}`;
      params.push(id);

      const result = await this.pool.query(query, params);
      if (result.rowCount === 0) {
        throw new Error(`Scan with id ${id} not found`);
      }

      logger.debug('Scan status updated', { scanId: id, status, error });
    });
  }

  async updateScanRiskScore(id: string, riskScore: number): Promise<void> {
    return this.withRetry(async () => {
      const result = await this.pool.query('UPDATE scans SET global_risk_score = $1 WHERE id = $2', [riskScore, id]);
      if (result.rowCount === 0) {
        throw new Error(`Scan with id ${id} not found`);
      }
      logger.debug('Scan risk score updated', { scanId: id, riskScore });
    });
  }

  async listScans(limit: number, offset: number): Promise<{ items: Scan[]; total: number; limit: number; offset: number }> {
    return this.withRetry(async () => {
      const [rowsRes, countRes] = await Promise.all([
        this.pool.query('SELECT * FROM scans ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]),
        this.pool.query('SELECT COUNT(*)::int AS total FROM scans'),
      ]);

      const items: Scan[] = rowsRes.rows.map((row: any) => ({
        id: row.id,
        url: row.url,
        parameters: row.metadata,
        status: row.status as ScanStatus,
        createdAt: row.created_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        globalRiskScore: row.global_risk_score,
        artifactPaths: row.artifact_paths,
        error: row.error,
      }));

      return {
        items,
        total: countRes.rows[0]?.total || 0,
        limit,
        offset,
      };
    });
  }

  async deleteScan(id: string): Promise<void> {
    return this.withRetry(async () => {
      const result = await this.pool.query('DELETE FROM scans WHERE id = $1', [id]);
      if (result.rowCount === 0) {
        throw new Error(`Scan with id ${id} not found`);
      }
      logger.debug('Scan deleted', { scanId: id });
    });
  }
}
