// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { EventEmitter } from 'events';

// Mock external deps that AnalysisWorker constructor touches
jest.mock('ioredis', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      brpop: jest.fn(),
      lpush: jest.fn(),
      disconnect: jest.fn(),
      on: jest.fn(),
    })),
  };
});

jest.mock('minio', () => {
  return {
    Client: jest.fn().mockImplementation(() => ({})),
  };
});

jest.mock('pg', () => {
  return {
    Pool: jest.fn().mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue({
        query: jest.fn(),
        release: jest.fn(),
      }),
      end: jest.fn(),
      query: jest.fn(),
    })),
  };
});

jest.mock('bull', () => {
  const q = jest.fn().mockImplementation(() => ({
    process: jest.fn(),
    on: jest.fn(),
    close: jest.fn(),
  }));
  return { __esModule: true, default: q };
});

jest.mock('../fingerprinting/library-detector', () => {
  return {
    LibraryDetector: jest.fn().mockImplementation(() => ({
      detectLibraries: jest.fn().mockResolvedValue([]),
    })),
  };
});

jest.mock('../vulnerability/feed-client', () => {
  return {
    VulnerabilityFeedClient: jest.fn().mockImplementation(() => ({
      enrichLibraries: jest.fn().mockResolvedValue([]),
    })),
  };
});

jest.mock('../analysis/risk-calculator', () => {
  return {
    ScanRiskCalculator: jest.fn().mockImplementation(() => ({
      calculateOverallRisk: jest.fn().mockReturnValue({ score: 0 }),
    })),
  };
});

jest.mock('../intel/threat-intelligence', () => {
  return {
    ThreatIntelligenceEngine: jest.fn().mockImplementation(() => new EventEmitter()),
  };
});

jest.mock('../integrity/integrity-verifier', () => {
  return {
    IntegrityVerifier: jest.fn().mockImplementation(() => new EventEmitter()),
  };
});

jest.mock('../monitoring/monitor', () => {
  return {
    MonitoringSystem: jest.fn().mockImplementation(() => new EventEmitter()),
  };
});

jest.mock('../reporting/analytics', () => {
  return {
    AnalyticsEngine: jest.fn().mockImplementation(() => new EventEmitter()),
  };
});

jest.mock('../crypto/crypto-analyzer', () => {
  return {
    CryptoAnalyzer: jest.fn().mockImplementation(() => new EventEmitter()),
  };
});

describe('AnalysisWorker.processAnalysisTask safeguards', () => {
  let AnalysisWorker: any;

  beforeEach(async () => {
    jest.resetModules();
    jest.useFakeTimers();

    const mod = await import('../worker');
    AnalysisWorker = mod.AnalysisWorker;
  });

  it('validateTask rejects malformed tasks', () => {
    const w = new AnalysisWorker();

    expect((w as any).validateTask(null)).toBeFalsy();
    expect((w as any).validateTask({})).toBeFalsy();
    expect((w as any).validateTask({ scanId: '' })).toBeFalsy();
    expect((w as any).validateTask({ scanId: 'x', artifacts: {} })).toBeFalsy();
    expect((w as any).validateTask({ scanId: 'x', artifacts: {}, domAnalysis: {} })).toBeTruthy();
  });

  it('timeout triggers updateScanStatus(scanId, failed, timeout)', async () => {
    const w = new AnalysisWorker();

    (w as any).updateScanStatus = jest.fn().mockResolvedValue(undefined);
    (w as any).processAnalysisTask = jest.fn(() => new Promise(() => {})); // never resolves

    const task = { scanId: 'scan-timeout', artifacts: {}, domAnalysis: {} };

    (w as any).processTaskWithSafeguards(task, 't-1');

    // advance 10 minutes
    jest.advanceTimersByTime(600000);

    // allow pending promise microtasks
    await Promise.resolve();

    expect((w as any).updateScanStatus).toHaveBeenCalledWith('scan-timeout', 'failed', 'Processing timeout');

    // cleanup: stop promise
    (w as any).isRunning = false;
    // don't await p (it will never resolve)
    expect((w as any).processingTasks.has('scan-timeout')).toBe(false);
  });

  it('startTaskProcessor requeues duplicate tasks instead of processing', async () => {
    const w = new AnalysisWorker();

    // Seed as already processing
    (w as any).processingTasks.add('dup');

    const redis = (w as any).redis;

    // One iteration only
    redis.brpop.mockImplementationOnce(async () => {
      // stop after this iteration
      (w as any).isRunning = false;
      return ["analysis-queue", JSON.stringify({ scanId: 'dup', artifacts: {}, domAnalysis: {} })];
    });

    redis.lpush.mockResolvedValueOnce(1);

    (w as any).isRunning = true;

    await (w as any).startTaskProcessor('processor-test');

    expect(redis.lpush).toHaveBeenCalledTimes(1);
    expect((w as any).processingTasks.has('dup')).toBe(true);
  });
});
