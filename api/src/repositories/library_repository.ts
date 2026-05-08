/**
 * Dependency diagram:
 * Database -> LibraryRepository -> pg.Pool
 * Database -> FindingRepository -> pg.Pool
 */
import { v4 as uuidv4 } from 'uuid';
import type { Pool, PoolClient } from 'pg';
import type { Library, Finding } from '@shieldeye/shared';
import { logger } from '../logger';

export type RetryOperation = <T>(operation: () => Promise<T>) => Promise<T>;
export type TransactionOperation = <T>(operation: (client: PoolClient) => Promise<T>) => Promise<T>;

export class LibraryRepository {
  constructor(
    private readonly pool: Pool,
    private readonly withRetry: RetryOperation,
    private readonly withTransaction: TransactionOperation,
  ) {}

  async createLibrary(library: Omit<Library, 'id'>): Promise<string> {
    return this.withRetry(async () => {
      const id = uuidv4();
      await this.pool.query(
        `INSERT INTO libraries (id, scan_id, name, detected_version, related_scripts, vulnerabilities, risk_score, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          library.scanId,
          library.name,
          library.detectedVersion,
          library.relatedScripts,
          JSON.stringify(library.vulnerabilities),
          library.riskScore,
          library.confidence,
        ],
      );
      logger.debug('Library created', { libraryId: id, scanId: library.scanId, name: library.name });
      return id;
    });
  }

  async getLibrariesByScan(scanId: string): Promise<Library[]> {
    return this.withRetry(async () => {
      const result = await this.pool.query('SELECT * FROM libraries WHERE scan_id = $1', [scanId]);
      return result.rows.map((row: any) => ({
        id: row.id,
        scanId: row.scan_id,
        name: row.name,
        detectedVersion: row.detected_version,
        relatedScripts: row.related_scripts,
        vulnerabilities: row.vulnerabilities,
        riskScore: row.risk_score,
        confidence: row.confidence,
      }));
    });
  }

  async createLibrariesBatch(libraries: Array<Omit<Library, 'id'>>): Promise<string[]> {
    if (!libraries || libraries.length === 0) return [];

    return this.withTransaction(async (client) => {
      const ids = libraries.map(() => uuidv4());
      const values: any[] = [];

      const placeholders = libraries
        .map((library, index) => {
          const base = index * 8;
          values.push(
            ids[index],
            library.scanId,
            library.name,
            library.detectedVersion ?? null,
            library.relatedScripts ?? [],
            JSON.stringify(library.vulnerabilities ?? []),
            library.riskScore ?? 0,
            library.confidence ?? 0,
          );
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
        })
        .join(', ');

      await client.query(
        `INSERT INTO libraries (id, scan_id, name, detected_version, related_scripts, vulnerabilities, risk_score, confidence)
         VALUES ${placeholders}`,
        values,
      );

      logger.debug('Libraries batch created', { count: libraries.length });
      return ids;
    });
  }

  async getLibrary(id: string): Promise<Library | null> {
    return this.withRetry(async () => {
      const result = await this.pool.query('SELECT * FROM libraries WHERE id = $1', [id]);
      if (result.rows.length === 0) return null;

      const row = result.rows[0];
      return {
        id: row.id,
        scanId: row.scan_id,
        name: row.name,
        detectedVersion: row.detected_version,
        relatedScripts: row.related_scripts,
        vulnerabilities: row.vulnerabilities,
        riskScore: row.risk_score,
        confidence: row.confidence,
      };
    });
  }
}

export class FindingRepository {
  constructor(
    private readonly pool: Pool,
    private readonly withRetry: RetryOperation,
  ) {}

  async createFinding(finding: Omit<Finding, 'id'>): Promise<string> {
    return this.withRetry(async () => {
      const id = uuidv4();
      await this.pool.query(
        `INSERT INTO findings (id, scan_id, type, title, description, severity, location, evidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          finding.scanId,
          finding.type,
          finding.title,
          finding.description,
          finding.severity,
          JSON.stringify(finding.location),
          finding.evidence,
        ],
      );
      logger.debug('Finding created', {
        findingId: id,
        scanId: finding.scanId,
        type: finding.type,
        severity: finding.severity,
      });
      return id;
    });
  }

  async getFindingsByScan(scanId: string): Promise<Finding[]> {
    return this.withRetry(async () => {
      const result = await this.pool.query('SELECT * FROM findings WHERE scan_id = $1', [scanId]);
      return result.rows.map((row: any) => ({
        id: row.id,
        scanId: row.scan_id,
        type: row.type,
        title: row.title,
        description: row.description,
        severity: row.severity as any,
        location: row.location,
        evidence: row.evidence,
      }));
    });
  }

  async getFindingsCountByTypes(types: string[]): Promise<number> {
    if (!types || types.length === 0) {
      return 0;
    }

    return this.withRetry(async () => {
      const result = await this.pool.query(
        `
          SELECT COUNT(*)::int AS count
          FROM findings
          WHERE type = ANY($1::text[])
        `,
        [types],
      );

      return result.rows[0]?.count || 0;
    });
  }
}
