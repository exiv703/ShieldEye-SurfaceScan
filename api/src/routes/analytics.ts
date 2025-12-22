import { Router, Request, Response } from 'express';
import { Database } from '../database';
import { logger } from '../logger';

export class AnalyticsRoutes {
  private router: Router;
  private database: Database;

  constructor(database: Database) {
    this.router = Router();
    this.database = database;
    this.setupRoutes();
  }

  private setupRoutes(): void {
    /**
     * @swagger
     * /api/analytics/summary:
     *   get:
     *     summary: Get analytics summary for dashboard
     *     tags: [Analytics]
     *     responses:
     *       200:
     *         description: Analytics summary
     */
    this.router.get('/summary', this.getSummary.bind(this));

    /**
     * @swagger
     * /api/analytics/reports:
     *   get:
     *     summary: List available reports (derived from scans for now)
     *     tags: [Analytics]
     *     responses:
     *       200:
     *         description: Reports list
     */
    this.router.get('/reports', this.getReports.bind(this));
  }

  private async getSummary(_req: Request, res: Response): Promise<void> {
    try {
      const [
        librariesCount,
        totalFindings,
        severityCounts,
        totalScans,
        averageRiskScore,
        averageScanDurationSeconds,
        vulnerabilityTrends,
        surfaceFindingsCount,
        recentScanCounts,
      ] = await Promise.all([
        this.database.getLibrariesCount(),
        this.database.getTotalFindingsCount(),
        this.database.getFindingsSeverityCounts(),
        this.database.getScansCount(),
        this.database.getAverageRiskScore(),
        this.database.getAverageScanDurationSeconds(),
        this.database.getDailyVulnerabilityTrends(30),
        this.database.getFindingsCountByTypes([
          'FORM_SECURITY',
          'INLINE_EVENT_HANDLER',
          'IFRAME_SECURITY',
        ]),
        this.database.getDailyScanCounts(7),
      ]);

      const breakdown = {
        Critical:
          severityCounts['critical'] ||
          severityCounts['CRITICAL'] ||
          0,
        High:
          severityCounts['high'] ||
          severityCounts['HIGH'] ||
          0,
        Medium:
          severityCounts['medium'] ||
          severityCounts['moderate'] ||
          severityCounts['MEDIUM'] ||
          severityCounts['MODERATE'] ||
          0,
        Low:
          severityCounts['low'] ||
          severityCounts['LOW'] ||
          0,
      };

      const riskDistribution = {
        critical: breakdown.Critical,
        high: breakdown.High,
        medium: breakdown.Medium,
        low: breakdown.Low,
      };

      const topVulns = await this.database.getTopVulnerabilities(5);

      const activeThreats = breakdown.Critical;

      const payload = {
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
      };

      res.json(payload);
    } catch (error) {
      logger.error('Failed to produce analytics summary', {
        error: error instanceof Error ? error.message : String(error),
      });
      res
        .status(500)
        .json({ error: 'Failed to produce analytics summary' });
    }
  }

  private async getReports(_req: Request, res: Response): Promise<void> {
    try {
      const list = await this.database.listScans(50, 0);
      const items = (list.items || []).map((scan: any) => ({
        id: scan.id,
        name: `Scan Report - ${scan.url}`,
        type: 'Detailed',
        created: scan.createdAt,
      }));
      res.json({ items });
    } catch (error) {
      logger.error('Failed to list reports', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: 'Failed to list reports' });
    }
  }

  getRouter(): Router {
    return this.router;
  }
}
