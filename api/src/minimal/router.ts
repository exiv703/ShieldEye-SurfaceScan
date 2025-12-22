import { Router } from 'express';
import { ScanStatus } from '@shieldeye/shared';
import type { Database } from '../database';
import type { TaskQueue } from '../queue';
import { logger } from '../logger';
import { minimalAnalyzeAndPersist } from './analyzer';

export function createMinimalRouter(opts: { database: Database; taskQueue: TaskQueue }) {
  const { database, taskQueue } = opts;
  const router = Router();

  // Create scan
  router.post('/scans', async (req, res) => {
    try {
      const { url, renderJavaScript, timeout, crawlDepth, scanType } = req.body || {};

      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'url is required' });
      }

      const parameters = {
        url,
        renderJavaScript: renderJavaScript !== undefined ? !!renderJavaScript : true,
        timeout: typeof timeout === 'number' ? timeout : 30000,
        crawlDepth: typeof crawlDepth === 'number' ? crawlDepth : 1,
        scanType: typeof scanType === 'string' ? scanType : 'comprehensive',
      };

      const scanId = await database.createScan({
        url,
        parameters,
        status: ScanStatus.PENDING,
        globalRiskScore: 0,
        artifactPaths: {},
        error: undefined,
      } as any);

      await taskQueue.addScanJob({
        scanId,
        url,
        parameters,
        createdAt: new Date(),
      } as any);

      return res.status(201).json({
        id: scanId,
        status: ScanStatus.PENDING,
        url,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Minimal router: failed to create scan', {
        error: error instanceof Error ? error.message : error,
      });
      return res.status(500).json({ error: 'Failed to create scan' });
    }
  });

  // Scan details
  router.get('/scans/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const scan = await database.getScan(id);
      if (!scan) {
        return res.status(404).json({ error: 'Scan not found' });
      }

      return res.json({
        id: scan.id,
        status: scan.status,
        url: scan.url,
        createdAt: scan.createdAt.toISOString(),
        startedAt: scan.startedAt?.toISOString(),
        completedAt: scan.completedAt?.toISOString(),
        globalRiskScore: scan.globalRiskScore,
        error: scan.error,
      });
    } catch (error) {
      logger.error('Minimal router: failed to get scan', {
        scanId: req.params.id,
        error: error instanceof Error ? error.message : error,
      });
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Scan status
  router.get('/scans/:id/status', async (req, res) => {
    try {
      const { id } = req.params;
      const scan = await database.getScan(id);
      if (!scan) {
        return res.status(404).json({ error: 'Scan not found' });
      }

      const jobStatus = await taskQueue.getScanJobStatus(id);

      let effectiveStatus: any = scan.status;
      if (jobStatus) {
        const state = jobStatus.status;
        const result: any = jobStatus.result;
        if (state === 'active' || state === 'waiting' || state === 'delayed') {
          effectiveStatus = ScanStatus.RUNNING;
        } else if (state === 'completed') {
          effectiveStatus = result && result.success === false ? ScanStatus.FAILED : ScanStatus.COMPLETED;
        } else if (state === 'failed' || state === 'dead-letter') {
          effectiveStatus = ScanStatus.FAILED;
        }
      }

      const progress = jobStatus?.progress ?? (effectiveStatus === ScanStatus.COMPLETED || effectiveStatus === ScanStatus.FAILED ? 100 : 0);

      return res.json({
        id: scan.id,
        status: effectiveStatus,
        progress,
        createdAt: scan.createdAt.toISOString(),
        startedAt: (scan.startedAt || jobStatus?.processedOn)?.toISOString?.() || (jobStatus?.processedOn ? new Date(jobStatus.processedOn as any).toISOString() : undefined),
        completedAt: (scan.completedAt || jobStatus?.finishedOn)?.toISOString?.() || (jobStatus?.finishedOn ? new Date(jobStatus.finishedOn as any).toISOString() : undefined),
        error: scan.error || jobStatus?.error,
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Minimal router: failed to get scan status', {
        scanId: req.params.id,
        error: error instanceof Error ? error.message : error,
      });
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Scan list
  router.get('/scans', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 100);
      const offset = parseInt(req.query.offset as string, 10) || 0;

      const result = await database.listScans(limit, offset);

      return res.json({
        scans: result.items,
        total: result.total,
        limit: result.limit,
        offset: result.offset,
      });
    } catch (error) {
      logger.error('Minimal router: failed to list scans', {
        error: error instanceof Error ? error.message : error,
      });
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Scan results (minimal analysis)
  router.get('/scans/:id/results', async (req, res) => {
    try {
      const { id } = req.params;
      const scan = await database.getScan(id);
      if (!scan) {
        return res.status(404).json({ error: 'Scan not found' });
      }

      const { libraries, findings } = await minimalAnalyzeAndPersist(database, scan as any);

      const vulnerableLibraries = libraries.filter((lib: any) => (lib.vulnerabilities || []).length > 0).length;
      const totalVulnerabilities = libraries.reduce((sum: number, lib: any) => sum + (lib.vulnerabilities || []).length, 0);
      const criticalFindings = findings.filter((f: any) => f.severity === 'critical' || f.severity === 'CRITICAL').length;

      const riskDistribution = findings.reduce((acc: any, finding: any) => {
        const sev = (finding.severity || '').toString().toLowerCase() || 'unknown';
        acc[sev] = (acc[sev] || 0) + 1;
        return acc;
      }, {} as any);

      return res.json({
        scan,
        libraries,
        findings,
        summary: {
          totalLibraries: libraries.length,
          vulnerableLibraries,
          totalVulnerabilities,
          criticalFindings,
          riskDistribution,
        },
      });
    } catch (error) {
      logger.error('Minimal router: failed to get scan results', {
        scanId: req.params.id,
        error: error instanceof Error ? error.message : error,
      });
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Analytics summary (minimal)
  router.get('/analytics/summary', async (_req, res) => {
    try {
      const [
        totalScans,
        librariesCount,
        totalFindings,
        averageRiskScore,
        averageScanDurationSeconds,
        vulnerabilityTrends,
        severityCounts,
        surfaceFindingsCount,
        recentScanCounts,
      ] = await Promise.all([
        database.getScansCount(),
        database.getLibrariesCount(),
        database.getTotalFindingsCount(),
        database.getAverageRiskScore(),
        database.getAverageScanDurationSeconds(),
        database.getDailyVulnerabilityTrends(30),
        database.getFindingsSeverityCounts(),
        database.getFindingsCountByTypes(['FORM_SECURITY', 'INLINE_EVENT_HANDLER', 'IFRAME_SECURITY']),
        database.getDailyScanCounts(7),
      ]);

      const breakdown = {
        Critical: severityCounts['critical'] || severityCounts['CRITICAL'] || 0,
        High: severityCounts['high'] || severityCounts['HIGH'] || 0,
        Medium:
          severityCounts['medium'] ||
          severityCounts['moderate'] ||
          severityCounts['MEDIUM'] ||
          severityCounts['MODERATE'] ||
          0,
        Low: severityCounts['low'] || severityCounts['LOW'] || 0,
      };

      const riskDistribution = {
        critical: breakdown.Critical,
        high: breakdown.High,
        medium: breakdown.Medium,
        low: breakdown.Low,
      };

      const topVulns = await database.getTopVulnerabilities(5);
      const activeThreats = breakdown.Critical;

      return res.json({
        totalScans,
        scansChange: 0,
        activeThreats,
        threatsChange: 0,
        totalVulnerabilities: totalFindings,
        vulnerabilitiesChange: 0,
        averageRiskScore,
        avgRiskScore: averageRiskScore,
        averageScanDurationSeconds,
        avgScanDurationSeconds: averageScanDurationSeconds,
        riskDistribution,
        vulnerabilityTrends,
        recentScans: recentScanCounts,
        libraries_analyzed: librariesCount,
        total_vulnerabilities: totalFindings,
        ai_threats_detected: totalFindings,
        blockchain_verifications: 0,
        vulnerability_breakdown: breakdown,
        top_vulnerabilities: topVulns,
        application_surface_findings: surfaceFindingsCount,
      });
    } catch (error) {
      logger.error('Minimal router: failed to produce analytics summary', {
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({ error: 'Failed to produce analytics summary' });
    }
  });

  // Queue stats
  router.get('/queue/stats', async (_req, res) => {
    try {
      const stats = await taskQueue.getQueueStats();
      return res.json(stats);
    } catch (error) {
      logger.error('Minimal router: failed to get queue stats', {
        error: error instanceof Error ? error.message : error,
      });
      return res.status(500).json({ error: 'Failed to get queue stats' });
    }
  });

  return router;
}
