/**
 * Dependency diagram:
 * AnalysisWorker -> ScanService -> AnalysisEngine
 * AnalysisWorker -> ScanService -> ResultPersister
 */
import { logger } from '../logger';
import type { AnalysisEngine, AnalysisTaskInput } from './analysis_engine';
import type { ResultPersister } from './result_persister';

export interface ScanServiceDeps {
  analysisEngine: AnalysisEngine;
  resultPersister: ResultPersister;
  withRetry<T>(operation: () => Promise<T>, maxAttempts?: number, delayMs?: number): Promise<T>;
  updateScanStatus(scanId: string, status: string, error?: string): Promise<void>;
}

export class ScanService {
  constructor(private readonly deps: ScanServiceDeps) {}

  async processAnalysisTask(task: AnalysisTaskInput & { fetchErrors?: unknown[] }): Promise<void> {
    const { scanId, fetchErrors, domAnalysis } = task;

    if (fetchErrors && fetchErrors.length > 0) {
      logger.warn('Received task with fetch errors from renderer', { scanId, fetchErrors });
    }

    const startTime = Date.now();
    logger.info('Processing analysis task', { scanId, startTime });

    try {
      await this.deps.withRetry(() => this.deps.updateScanStatus(scanId, 'running'), 3);

      const analysisResult = await this.deps.analysisEngine.analyze(task);

      await this.deps.resultPersister.saveEnhancedAnalysisResults(
        scanId,
        analysisResult.scripts,
        analysisResult.libraries,
        analysisResult.findings,
        analysisResult.riskScore,
        analysisResult.aiAnalysis,
        analysisResult.integrityReports,
        analysisResult.supplyChainAnalysis,
        analysisResult.quantumReadiness,
        analysisResult.analyticsReport,
      );

      await this.deps.updateScanStatus(scanId, 'completed');

      logger.info('Analysis completed successfully', {
        scanId,
        librariesFound: analysisResult.libraries.length,
        vulnerabilities: analysisResult.libraries.reduce(
          (sum, lib) => sum + lib.vulnerabilities.length,
          0,
        ),
        findings: analysisResult.findings.length,
        inlineScripts: domAnalysis?.scripts?.inline?.length || 0,
        externalScripts: domAnalysis?.scripts?.external?.length || 0,
        scriptsPersisted: analysisResult.scripts.length,
        riskScore: analysisResult.riskScore,
      });
    } catch (error) {
      logger.error('Analysis task failed', {
        scanId,
        error: error instanceof Error ? error.message : error,
      });

      await this.deps.updateScanStatus(
        scanId,
        'failed',
        error instanceof Error ? error.message : 'Unknown error',
      );
    }
  }
}
