// Krok 2.2: Integration tests for result_persister
import { describe, expect, it, jest } from '@jest/globals';
import type { Pool } from 'pg';
import type { Finding, Library, Script } from '@shieldeye/shared';
import { ResultPersister } from '../services/result_persister';

type QueryFn = (text: string, values?: unknown[]) => Promise<unknown>;
interface MockDbClient {
  query: jest.MockedFunction<QueryFn>;
  release: jest.MockedFunction<() => void>;
}

const createScript = (scanId: string): Script => ({
  id: 'script-1',
  scanId,
  sourceUrl: undefined,
  isInline: true,
  artifactPath: `scans/${scanId}/scripts/inline-script-1.js`,
  fingerprint: 'fp-1',
  detectedPatterns: [],
  estimatedVersion: '1.0.0',
  confidence: 90,
});

const createLibrary = (scanId: string): Library => ({
  id: 'lib-1',
  scanId,
  name: 'react',
  detectedVersion: '18.2.0',
  relatedScripts: ['script-1'],
  vulnerabilities: [{ id: 'CVE-123', severity: 'critical', cvssScore: 9.8 } as never],
  riskScore: 87,
  confidence: 96,
});

const createFinding = (scanId: string): Finding => ({
  id: 'finding-1',
  scanId,
  type: 'eval_usage' as never,
  title: 'Eval usage',
  description: 'Detected eval()',
  severity: 'high' as never,
  location: { scriptId: 'script-1', line: 12 },
  evidence: 'eval(userInput)',
});

const createPoolMock = (queryImpl?: QueryFn): { pool: Pool; client: MockDbClient } => {
  const query: jest.MockedFunction<QueryFn> = jest.fn<QueryFn>(queryImpl ?? (async (): Promise<unknown> => ({ rows: [] })));
  const release: jest.MockedFunction<() => void> = jest.fn<() => void>();
  const client: MockDbClient = { query, release };

  const connect = jest.fn(async () => client) as unknown as Pool['connect'];
  const pool = { connect } as unknown as Pool;

  return { pool, client };
};

describe('ResultPersister transaction orchestration', () => {
  it('persists complete payload in transaction and commits', async () => {
    const scanId = 'scan-commit';
    const { pool, client } = createPoolMock();
    const persister = new ResultPersister(pool);

    await persister.saveEnhancedAnalysisResults(
      scanId,
      [createScript(scanId)],
      [createLibrary(scanId)],
      [createFinding(scanId)],
      84.6,
      {
        threatIntelligence: { indicators: [] },
        riskAssessment: { overallRisk: 'high' },
        behavioralAnalysis: { anomalies: [] },
        predictions: { nextWeek: 'stable' },
      },
      [
        {
          packageName: 'react',
          version: '18.2.0',
          integrityStatus: 'verified',
          verificationMethod: 'blockchain',
          confidence: 99,
          details: { chain: 'eth' },
        },
      ],
      {
        riskAssessment: { score: 42 },
        recommendations: [{ title: 'Pin versions' }],
        supplyChainMap: { nodes: [] },
      },
      {
        overallReadiness: 'low',
        cryptoInventory: [],
        threats: [],
        migrationPlan: [],
        timeline: {},
        costEstimate: {},
      },
      {
        type: 'security',
        title: 'Analytics',
        generatedAt: '2026-01-01T00:00:00.000Z',
        summary: {},
        sections: [],
        recommendations: [],
        charts: [],
      },
    );

    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.query).toHaveBeenCalledWith('UPDATE scans SET global_risk_score = $1 WHERE id = $2', [85, scanId]);
    expect(client.release).toHaveBeenCalledTimes(1);

    const serializedLibraryInsert = client.query.mock.calls.find(
      ([statement]) => statement.includes('INSERT INTO libraries'),
    );
    expect(serializedLibraryInsert).toBeDefined();
    expect(serializedLibraryInsert?.[1]?.[5]).toBe(JSON.stringify(createLibrary(scanId).vulnerabilities));
  });

  it('rolls back transaction on insert error and rethrows', async () => {
    const scanId = 'scan-rollback';
    let invocation = 0;

    const { pool, client } = createPoolMock(async (statement: string): Promise<unknown> => {
      invocation += 1;
      if (statement.includes('INSERT INTO libraries')) {
        throw new Error('insert failed');
      }
      return { rows: [] };
    });
    const persister = new ResultPersister(pool);

    await expect(
      persister.saveEnhancedAnalysisResults(
        scanId,
        [createScript(scanId)],
        [createLibrary(scanId)],
        [createFinding(scanId)],
        41,
        {
          threatIntelligence: {},
          riskAssessment: {},
          behavioralAnalysis: {},
          predictions: {},
        },
        [],
        {
          riskAssessment: {},
          recommendations: [],
          supplyChainMap: {},
        },
        {
          overallReadiness: 'low',
          cryptoInventory: [],
          threats: [],
          migrationPlan: [],
          timeline: {},
          costEstimate: {},
        },
        {
          type: 'security',
          title: 'Analytics',
          generatedAt: '2026-01-01T00:00:00.000Z',
          summary: {},
          sections: [],
          recommendations: [],
          charts: [],
        },
      ),
    ).rejects.toThrow('insert failed');

    expect(invocation).toBeGreaterThanOrEqual(2);
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
