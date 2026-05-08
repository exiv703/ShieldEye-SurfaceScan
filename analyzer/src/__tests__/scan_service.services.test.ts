// Krok 2.2: Integration tests for scan_service
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ScanService, type ScanServiceDeps } from '../services/scan_service';
import type { AnalysisTaskInput, AnalysisTaskOutput } from '../services/analysis_engine';

type AnalyzeFn = (task: AnalysisTaskInput) => Promise<AnalysisTaskOutput>;
type SaveFn = (
  scanId: string,
  scripts: AnalysisTaskOutput['scripts'],
  libraries: AnalysisTaskOutput['libraries'],
  findings: AnalysisTaskOutput['findings'],
  globalRiskScore: number,
  aiAnalysis: AnalysisTaskOutput['aiAnalysis'],
  integrityReports: AnalysisTaskOutput['integrityReports'],
  supplyChainAnalysis: AnalysisTaskOutput['supplyChainAnalysis'],
  quantumReadiness: AnalysisTaskOutput['quantumReadiness'],
  analyticsReport: AnalysisTaskOutput['analyticsReport'],
) => Promise<void>;
type UpdateStatusFn = (scanId: string, status: string, error?: string) => Promise<void>;
type RetryInvoker = (
  operation: () => Promise<unknown>,
  maxAttempts?: number,
  delayMs?: number,
) => Promise<unknown>;

interface ScanServiceHarness {
  service: ScanService;
  analyzeMock: jest.MockedFunction<AnalyzeFn>;
  saveMock: jest.MockedFunction<SaveFn>;
  updateStatusMock: jest.MockedFunction<UpdateStatusFn>;
  retryInvokerMock: jest.MockedFunction<RetryInvoker>;
}

const createTask = (scanId: string): AnalysisTaskInput => ({
  scanId,
  artifacts: { pageUrl: 'https://example.com' },
  domAnalysis: {
    scripts: {
      inline: [{ content: 'const x = 1;' }],
      external: [{ src: 'https://cdn.example.com/app.js' }],
    },
    sourceMaps: [],
  },
});

const createAnalysisOutput = (scanId: string): AnalysisTaskOutput => ({
  scripts: [
    {
      id: 'script-1',
      scanId,
      sourceUrl: undefined,
      isInline: true,
      artifactPath: `scans/${scanId}/scripts/inline-script-1.js`,
      fingerprint: 'fp-1',
      detectedPatterns: [],
      estimatedVersion: '1.0.0',
      confidence: 90,
    },
  ],
  libraries: [
    {
      id: 'lib-1',
      scanId,
      name: 'react',
      detectedVersion: '18.2.0',
      relatedScripts: ['script-1'],
      vulnerabilities: [],
      riskScore: 12,
      confidence: 95,
    },
  ],
  findings: [
    {
      id: 'finding-1',
      scanId,
      type: 'eval_usage' as never,
      title: 'Eval usage',
      description: 'Detected eval',
      severity: 'high' as never,
      location: { scriptId: 'script-1', line: 1 },
      evidence: 'eval("x")',
    },
  ],
  riskScore: 67,
  aiAnalysis: { summary: 'ok' },
  integrityReports: [{ packageName: 'react', integrityStatus: 'verified' }],
  supplyChainAnalysis: { riskAssessment: {} },
  quantumReadiness: { overallReadiness: 'low' },
  analyticsReport: { type: 'security', title: 'Security report' },
});

const createHarness = (): ScanServiceHarness => {
  const analyzeMock: jest.MockedFunction<AnalyzeFn> = jest.fn<AnalyzeFn>();
  const saveMock: jest.MockedFunction<SaveFn> = jest.fn<SaveFn>();
  const updateStatusMock: jest.MockedFunction<UpdateStatusFn> = jest.fn<UpdateStatusFn>();
  const retryInvokerMock: jest.MockedFunction<RetryInvoker> = jest.fn<RetryInvoker>();

  const withRetryImpl: ScanServiceDeps['withRetry'] = async <T>(
    operation: () => Promise<T>,
    maxAttempts = 3,
  ): Promise<T> => {
    retryInvokerMock(operation as () => Promise<unknown>, maxAttempts);
    let attempt = 0;
    let lastError: unknown;

    while (attempt < maxAttempts) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        attempt += 1;
      }
    }

    throw lastError;
  };

  const service = new ScanService({
    analysisEngine: { analyze: analyzeMock } as unknown as ScanServiceDeps['analysisEngine'],
    resultPersister: {
      saveEnhancedAnalysisResults: saveMock,
    } as unknown as ScanServiceDeps['resultPersister'],
    withRetry: withRetryImpl,
    updateScanStatus: updateStatusMock,
  });

  return {
    service,
    analyzeMock,
    saveMock,
    updateStatusMock,
    retryInvokerMock,
  };
};

describe('ScanService integration orchestration', () => {
  let harness: ScanServiceHarness;

  beforeEach(() => {
    harness = createHarness();
  });

  it('runs happy path: status -> analysis -> persist -> completed', async () => {
    const scanId = 'scan-happy';
    const task = createTask(scanId);
    const output = createAnalysisOutput(scanId);

    harness.updateStatusMock.mockResolvedValue(undefined);
    harness.analyzeMock.mockResolvedValue(output);
    harness.saveMock.mockResolvedValue(undefined);

    await harness.service.processAnalysisTask(task);

    expect(harness.retryInvokerMock).toHaveBeenCalledTimes(1);
    expect(harness.retryInvokerMock).toHaveBeenCalledWith(expect.any(Function), 3);

    expect(harness.updateStatusMock).toHaveBeenNthCalledWith(1, scanId, 'running');
    expect(harness.analyzeMock).toHaveBeenCalledWith(task);
    expect(harness.saveMock).toHaveBeenCalledWith(
      scanId,
      output.scripts,
      output.libraries,
      output.findings,
      output.riskScore,
      output.aiAnalysis,
      output.integrityReports,
      output.supplyChainAnalysis,
      output.quantumReadiness,
      output.analyticsReport,
    );
    expect(harness.updateStatusMock).toHaveBeenLastCalledWith(scanId, 'completed');
  });

  it('handles analysis failure: marks failed and does not persist partial writes', async () => {
    const scanId = 'scan-failed';
    const task = createTask(scanId);
    const error = new Error('analysis crashed');

    harness.updateStatusMock.mockResolvedValue(undefined);
    harness.analyzeMock.mockRejectedValue(error);

    await harness.service.processAnalysisTask(task);

    expect(harness.saveMock).not.toHaveBeenCalled();
    expect(harness.updateStatusMock).toHaveBeenNthCalledWith(1, scanId, 'running');
    expect(harness.updateStatusMock).toHaveBeenNthCalledWith(2, scanId, 'failed', 'analysis crashed');
  });

  it('propagates timeout-style errors into failed status updates', async () => {
    const scanId = 'scan-timeout';
    const task = createTask(scanId);
    const timeoutError = new Error('Analysis timeout after 600000ms');

    harness.updateStatusMock.mockResolvedValue(undefined);
    harness.analyzeMock.mockRejectedValue(timeoutError);

    await harness.service.processAnalysisTask(task);

    expect(harness.saveMock).not.toHaveBeenCalled();
    expect(harness.updateStatusMock).toHaveBeenLastCalledWith(
      scanId,
      'failed',
      'Analysis timeout after 600000ms',
    );
  });

  it('retries transient status update failures via withRetry wrapper', async () => {
    const scanId = 'scan-retry';
    const task = createTask(scanId);
    const output = createAnalysisOutput(scanId);
    let runningAttempts = 0;

    harness.updateStatusMock.mockImplementation(async (_scanId: string, status: string): Promise<void> => {
      if (status === 'running') {
        runningAttempts += 1;
        if (runningAttempts < 3) {
          throw new Error('transient status update error');
        }
      }
    });
    harness.analyzeMock.mockResolvedValue(output);
    harness.saveMock.mockResolvedValue(undefined);

    await harness.service.processAnalysisTask(task);

    expect(runningAttempts).toBe(3);
    expect(harness.analyzeMock).toHaveBeenCalledTimes(1);
    expect(harness.saveMock).toHaveBeenCalledTimes(1);
    expect(harness.updateStatusMock).toHaveBeenLastCalledWith(scanId, 'completed');
  });
});
