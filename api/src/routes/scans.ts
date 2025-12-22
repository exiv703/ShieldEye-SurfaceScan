import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Database } from '../database';
import { TaskQueue } from '../queue';
import { logger } from '../logger';
import { MinioStorage } from '../storage';
import { ScanRequestSchema, ScanStatus, RiskLevel, ScanResultResponse } from '@shieldeye/shared';
import { validateTargetUrl } from '../security/url-validator';

/**
 * @swagger
 * components:
 *   schemas:
 *     ScanRequest:
 *       type: object
 *       required:
 *         - url
 *       properties:
 *         url:
 *           type: string
 *           format: uri
 *           description: Target URL to scan
 *           example: "https://example.com"
 *         renderJavaScript:
 *           type: boolean
 *           description: Whether to execute JavaScript during scanning
 *           default: true
 *         scanType:
 *           type: string
 *           enum: [basic, comprehensive, ai-enhanced]
 *           description: Type of scan to perform
 *           default: "comprehensive"
 *         options:
 *           type: object
 *           properties:
 *             timeout:
 *               type: integer
 *               description: Scan timeout in seconds
 *               default: 300
 *             depth:
 *               type: integer
 *               description: Maximum crawl depth
 *               default: 3
 */

export class ScanRoutes {
  private router: Router;
  private database: Database;
  private taskQueue: TaskQueue;
  private storage: MinioStorage;

  constructor(database: Database, taskQueue: TaskQueue) {
    this.router = Router();
    this.database = database;
    this.taskQueue = taskQueue;
    this.storage = new MinioStorage();
    this.setupRoutes();
  }

  private async getLastGoodScanForUrl(req: Request, res: Response): Promise<void> {
    try {
      const url = (req.query.url as string || '').trim();
      if (!url) {
        res.status(400).json({ error: 'Missing url query parameter' });
        return;
      }

      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
      const scans = await this.database.getRecentScansByUrl(url, limit);
      if (!scans || scans.length === 0) {
        res.status(404).json({ error: 'No scans found for this URL' });
        return;
      }

      for (const scan of scans) {
        if (scan.status !== ScanStatus.COMPLETED) continue;
        const [libraries, scripts] = await Promise.all([
          this.database.getLibrariesByScan(scan.id),
          this.database.getScriptsByScan(scan.id),
        ]);

        const scriptDiagnostics = {
          total: scripts.length,
          inline: scripts.filter((s: any) => s.isInline).length,
          external: scripts.filter((s: any) => !s.isInline).length,
        };
        const libraryDiagnostics = {
          total: libraries.length,
          vulnerable: libraries.filter((lib: any) => lib.vulnerabilities.length > 0).length,
          osvVulnerabilities: libraries.reduce((sum: number, lib: any) => sum + lib.vulnerabilities.length, 0),
        };

        let partialScan = false;
        if (scriptDiagnostics.total > 0 && libraryDiagnostics.total === 0) {
          partialScan = true;
        }
        if (scriptDiagnostics.total > 100 && libraryDiagnostics.total <= 2) {
          partialScan = true;
        }

        if (!partialScan) {
          res.json({
            scan,
            diagnostics: {
              scripts: scriptDiagnostics,
              libraries: libraryDiagnostics,
              partialScan: false,
            },
          });
          return;
        }
      }

      const fallback = scans[0];
      const [librariesFallback, scriptsFallback] = await Promise.all([
        this.database.getLibrariesByScan(fallback.id),
        this.database.getScriptsByScan(fallback.id),
      ]);

      res.json({
        scan: fallback,
        diagnostics: {
          scripts: {
            total: scriptsFallback.length,
            inline: scriptsFallback.filter((s: any) => s.isInline).length,
            external: scriptsFallback.filter((s: any) => !s.isInline).length,
          },
          libraries: {
            total: librariesFallback.length,
            vulnerable: librariesFallback.filter((lib: any) => lib.vulnerabilities.length > 0).length,
            osvVulnerabilities: librariesFallback.reduce((sum: number, lib: any) => sum + lib.vulnerabilities.length, 0),
          },
          partialScan: true,
        },
      });
    } catch (error) {
      logger.error('Error getting last good scan for URL', {
        url: req.query.url,
        error: error instanceof Error ? error.message : error,
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private setupRoutes(): void {
    this.router.post('/', this.createScan.bind(this));
    this.router.get('/by-url/last-good', this.getLastGoodScanForUrl.bind(this));
    this.router.get('/:id', this.getScan.bind(this));
    this.router.get('/:id/status', this.getScanStatus.bind(this));
    this.router.get('/:id/results', this.getScanResults.bind(this));
    this.router.get('/:id/surface', this.getScanSurface.bind(this));
    this.router.get('/', this.listScans.bind(this));
    this.router.delete('/:id', this.deleteScan.bind(this));
  }

  private async createScan(req: Request, res: Response): Promise<void> {
    try {
      const validation = ScanRequestSchema.safeParse(req.body);
      if (!validation.success) {
        res.status(400).json({
          error: 'Invalid request parameters',
          details: validation.error.errors
        });
        return;
      }

      const scanRequest = validation.data;
      try {
        await validateTargetUrl(scanRequest.url);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Invalid or disallowed target URL';
        logger.warn('Rejected scan due to invalid or disallowed URL', {
          url: scanRequest.url,
          error: message,
        });
        res.status(400).json({
          error: 'Invalid or disallowed target URL',
          details: message,
        });
        return;
      }

      try {
        const cooldownSeconds = parseInt(process.env.SCAN_URL_COOLDOWN_SECONDS || '30', 10) || 30;
        if (cooldownSeconds > 0) {
          const recent = await this.database.getRecentScansByUrl(scanRequest.url, 1);
          const latest = recent[0];
          if (latest) {
            const now = Date.now();
            const createdAt = latest.createdAt instanceof Date ? latest.createdAt.getTime() : new Date(latest.createdAt as any).getTime();
            const diffSeconds = (now - createdAt) / 1000;
            if (diffSeconds < cooldownSeconds) {
              const retryAfter = Math.ceil(cooldownSeconds - diffSeconds);
              logger.warn('Rejected scan due to per-URL cooldown', {
                url: scanRequest.url,
                lastScanId: latest.id,
                secondsSinceLastScan: diffSeconds,
                cooldownSeconds,
              });
              res.status(429).json({
                error: 'Too many scans for this URL. Please retry later.',
                retryAfterSeconds: retryAfter,
              });
              return;
            }
          }
        }
      } catch (e) {
        logger.warn('Failed to apply per-URL cooldown logic; continuing without cooldown', {
          url: scanRequest.url,
          error: e instanceof Error ? e.message : e,
        });
      }

      const scanId = await this.database.createScan({
        url: scanRequest.url,
        parameters: scanRequest,
        status: ScanStatus.PENDING,
        globalRiskScore: 0,
        artifactPaths: {}
      });

      const task = {
        scanId,
        url: scanRequest.url,
        parameters: scanRequest,
        createdAt: new Date()
      };

      await this.taskQueue.addScanJob(task);

      logger.info('Scan created and queued', { scanId, url: scanRequest.url });

      res.status(201).json({
        id: scanId,
        status: ScanStatus.PENDING,
        url: scanRequest.url,
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      logger.error('Error creating scan', { 
        errorMessage,
        requestBody: req.body,
        stack: error instanceof Error ? error.stack : undefined
      });
      res.status(500).json({ 
        error: 'Failed to create scan.',
        details: errorMessage
      });
    }
  }

  private async getScan(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const scan = await this.database.getScan(id);

      if (!scan) {
        res.status(404).json({ error: 'Scan not found' });
        return;
      }

      res.json({
        id: scan.id,
        status: scan.status,
        url: scan.url,
        createdAt: scan.createdAt.toISOString(),
        startedAt: scan.startedAt?.toISOString(),
        completedAt: scan.completedAt?.toISOString(),
        globalRiskScore: scan.globalRiskScore,
        error: scan.error
      });
    } catch (error) {
      logger.error('Error getting scan', { scanId: req.params.id, error: error instanceof Error ? error.message : error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private async getScanStatus(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      
      const scan = await this.database.getScan(id);
      if (!scan) {
        res.status(404).json({ error: 'Scan not found' });
        return;
      }

      let jobStatus = null;
      if (scan.status === ScanStatus.PENDING || scan.status === ScanStatus.RUNNING) {
        jobStatus = await this.taskQueue.getScanJobStatus(id);
      }

      let effectiveStatus = scan.status;
      if (jobStatus) {
        const state = (jobStatus as any).status;
        const result = (jobStatus as any).result;
        if (state === 'active' || state === 'waiting' || state === 'delayed') {
          effectiveStatus = ScanStatus.RUNNING as any;
        } else if (state === 'completed') {
          // If worker returned success=false, treat as failed
          if (result && result.success === false) {
            effectiveStatus = ScanStatus.FAILED as any;
          } else {
            effectiveStatus = ScanStatus.COMPLETED as any;
          }
        } else if (state === 'failed' || state === 'dead-letter') {
          effectiveStatus = ScanStatus.FAILED as any;
        }
      }

      if (
        effectiveStatus !== scan.status &&
        (effectiveStatus === ScanStatus.RUNNING ||
          effectiveStatus === ScanStatus.COMPLETED ||
          effectiveStatus === ScanStatus.FAILED)
      ) {
        try {
          const result = (jobStatus as any)?.result;
          const error =
            scan.error ||
            (jobStatus as any)?.error ||
            (result && result.success === false ? 'Worker reported failure' : undefined);
          await this.database.updateScanStatus(id, effectiveStatus as any, error);
        } catch (e) {
          logger.warn('Failed to reconcile scan status from queue to DB', {
            scanId: id,
            effectiveStatus,
            error: e instanceof Error ? e.message : e,
          });
        }
      }

      let progress = jobStatus?.progress ?? 0;
      if (!jobStatus && (effectiveStatus === ScanStatus.COMPLETED || effectiveStatus === ScanStatus.FAILED)) {
        progress = 100;
      }

      let stage = 'queued';
      if (effectiveStatus === ScanStatus.COMPLETED) stage = 'completed';
      else if (effectiveStatus === ScanStatus.FAILED) stage = 'failed';
      else if (jobStatus) {
        const state = (jobStatus as any).status;
        if (state === 'waiting' || state === 'delayed') stage = 'queued';
        else if (state === 'active') {
          if (progress < 10) stage = 'initializing';
          else if (progress < 40) stage = 'rendering';
          else if (progress < 70) stage = 'fetching_scripts';
          else if (progress < 85) stage = 'dispatching_analysis';
          else if (progress < 95) stage = 'analyzing';
          else stage = 'saving_results';
        } else if (state === 'completed') {
          stage = 'completed';
        } else if (state === 'failed' || state === 'dead-letter') {
          stage = 'failed';
        }
      } else {
        if (scan.status === ScanStatus.RUNNING) stage = 'analyzing';
        else if (scan.status === ScanStatus.PENDING) stage = 'queued';
      }

      const nowIso = new Date().toISOString();

      res.json({
        id: scan.id,
        status: effectiveStatus,
        progress,
        stage,
        createdAt: scan.createdAt.toISOString(),
        startedAt: (scan.startedAt || (jobStatus?.processedOn as any))?.toISOString?.() || (jobStatus?.processedOn ? new Date(jobStatus.processedOn as any).toISOString() : undefined),
        completedAt: (scan.completedAt || (jobStatus?.finishedOn as any))?.toISOString?.() || (jobStatus?.finishedOn ? new Date(jobStatus.finishedOn as any).toISOString() : undefined),
        error: scan.error || jobStatus?.error,
        checkedAt: nowIso
      });
    } catch (error) {
      logger.error('Error getting scan status', { scanId: req.params.id, error: error instanceof Error ? error.message : error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private async getScanResults(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      
      const scan = await this.database.getScan(id);
      if (!scan) {
        res.status(404).json({ error: 'Scan not found' });
        return;
      }

      const [libraries, findings, scripts] = await Promise.all([
        this.database.getLibrariesByScan(id),
        this.database.getFindingsByScan(id),
        this.database.getScriptsByScan(id),
      ]);

      const vulnerableLibraries = libraries.filter((lib: any) => lib.vulnerabilities.length > 0).length;
      const totalVulnerabilities = libraries.reduce((sum: number, lib: any) => sum + lib.vulnerabilities.length, 0);
      const criticalFindings = findings.filter((f: any) => f.severity === 'critical').length;

      const riskDistribution = findings.reduce((acc: any, finding: any) => {
        acc[finding.severity] = (acc[finding.severity] || 0) + 1;
        return acc;
      }, {} as Record<RiskLevel, number>);

      const scriptDiagnostics = {
        total: scripts.length,
        inline: scripts.filter((s: any) => s.isInline).length,
        external: scripts.filter((s: any) => !s.isInline).length,
      };

      const libraryDiagnostics = {
        total: libraries.length,
        vulnerable: vulnerableLibraries,
        osvVulnerabilities: totalVulnerabilities,
      };

      let partialScan = false;
      const anomalies: string[] = [];

      if (scriptDiagnostics.total > 0 && libraryDiagnostics.total === 0) {
        partialScan = true;
        anomalies.push('no_libraries_detected_but_scripts_present');
      }

      if (scriptDiagnostics.total > 100 && libraryDiagnostics.total <= 2) {
        partialScan = true;
        anomalies.push('very_few_libraries_compared_to_script_volume');
      }

      let qualityScore = 100;
      if (partialScan) {
        qualityScore -= 40;
      }
      if (scriptDiagnostics.total < 10) {
        qualityScore -= 20;
      }
      if (libraryDiagnostics.total === 0) {
        qualityScore -= 40;
      }
      qualityScore = Math.max(0, Math.min(100, qualityScore));

      const diagnostics = {
        scripts: scriptDiagnostics,
        libraries: libraryDiagnostics,
        partialScan: partialScan || undefined,
        anomalies: anomalies.length ? anomalies : undefined,
        qualityScore,
      };

      if (diagnostics.partialScan) {
        logger.warn('Scan diagnostics indicate potential partial or degraded scan', {
          scanId: scan.id,
          url: scan.url,
          scripts: diagnostics.scripts,
          libraries: diagnostics.libraries,
          anomalies: diagnostics.anomalies,
        });
      }

      const response = {
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
        diagnostics,
      };

      res.json(response);
    } catch (error) {
      logger.error('Error getting scan results', { scanId: req.params.id, error: error instanceof Error ? error.message : error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private async getScanSurface(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const scan = await this.database.getScan(id);
      if (!scan) {
        res.status(404).json({ error: 'Scan not found' });
        return;
      }

      const findings = await this.database.getFindingsByScan(id);

      const CATEGORY_TYPES = {
        forms: ['FORM_SECURITY'],
        inlineEventHandlers: ['INLINE_EVENT_HANDLER'],
        iframes: ['IFRAME_SECURITY'],
        securityHeaders: ['SECURITY_HEADER'],
        securityCookies: ['SECURITY_COOKIE'],
      };

      const isOfType = (f: any, types: readonly string[]) => {
        const t = (f.type || '').toString().toUpperCase();
        return types.includes(t);
      };

      const forms = findings.filter((f: any) =>
        isOfType(f, CATEGORY_TYPES.forms),
      );
      const inlineEventHandlers = findings.filter((f: any) =>
        isOfType(f, CATEGORY_TYPES.inlineEventHandlers),
      );
      const iframes = findings.filter((f: any) =>
        isOfType(f, CATEGORY_TYPES.iframes),
      );
      const securityHeaders = findings.filter((f: any) =>
        isOfType(f, CATEGORY_TYPES.securityHeaders),
      );
      const securityCookies = findings.filter((f: any) =>
        isOfType(f, CATEGORY_TYPES.securityCookies),
      );

      const knownTypes = new Set<string>([
        ...CATEGORY_TYPES.forms,
        ...CATEGORY_TYPES.inlineEventHandlers,
        ...CATEGORY_TYPES.iframes,
        ...CATEGORY_TYPES.securityHeaders,
        ...CATEGORY_TYPES.securityCookies,
      ]);

      const other = findings.filter((f: any) => {
        const t = (f.type || '').toString().toUpperCase();
        return !knownTypes.has(t);
      });

      const severityCounts: Record<string, number> = {};
      for (const f of findings as any[]) {
        const sev = (f.severity || '').toString().toLowerCase() || 'unknown';
        severityCounts[sev] = (severityCounts[sev] || 0) + 1;
      }

      const payload = {
        scan: {
          id: scan.id,
          url: scan.url,
          status: scan.status,
          createdAt: scan.createdAt.toISOString(),
          startedAt: scan.startedAt?.toISOString(),
          completedAt: scan.completedAt?.toISOString(),
          globalRiskScore: scan.globalRiskScore,
        },
        stats: {
          totalFindings: findings.length,
          severity: severityCounts,
          categories: {
            forms: forms.length,
            inlineEventHandlers: inlineEventHandlers.length,
            iframes: iframes.length,
            securityHeaders: securityHeaders.length,
            securityCookies: securityCookies.length,
            other: other.length,
          },
        },
        categories: {
          forms,
          inlineEventHandlers,
          iframes,
          securityHeaders,
          securityCookies,
          other,
        },
      };

      res.json(payload);
    } catch (error) {
      logger.error('Error getting scan surface', {
        scanId: req.params.id,
        error: error instanceof Error ? error.message : error,
      });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private async listScans(req: Request, res: Response): Promise<void> {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;

      const result = await this.database.listScans(limit, offset);
      res.json({
        scans: result.items,
        total: result.total,
        limit: result.limit,
        offset: result.offset
      });
    } catch (error) {
      logger.error('Error listing scans', { error: error instanceof Error ? error.message : error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  private async deleteScan(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      // Check existing
      const scan = await this.database.getScan(id);
      if (!scan) {
        res.status(404).json({ error: 'Scan not found' });
        return;
      }

      // Try to delete artifacts first (best effort)
      try {
        await this.storage.deleteScanArtifacts(id);
      } catch (e) {
        logger.warn('Failed to delete some artifacts from storage', { scanId: id, error: e instanceof Error ? e.message : e });
      }

      // Delete DB row (cascades to related tables)
      await this.database.deleteScan(id);

      res.status(204).send();
    } catch (error) {
      logger.error('Error deleting scan', { scanId: req.params.id, error: error instanceof Error ? error.message : error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  getRouter(): Router {
    return this.router;
  }
}
