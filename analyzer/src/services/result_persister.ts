/**
 * Dependency diagram:
 * AnalysisWorker -> ScanService -> ResultPersister -> PostgreSQL
 */
import type { Pool } from 'pg';
import type { Script, Library, Finding } from '@shieldeye/shared';

export class ResultPersister {
  constructor(private readonly database: Pool) {}

  async saveEnhancedAnalysisResults(
    scanId: string,
    scripts: Script[],
    libraries: Library[],
    findings: Finding[],
    globalRiskScore: number,
    aiAnalysis: any,
    integrityReports: any[],
    supplyChainAnalysis: any,
    quantumReadiness: any,
    analyticsReport: any,
  ): Promise<void> {
    const client = await this.database.connect();

    try {
      await client.query('BEGIN');

      for (const script of scripts) {
        await client.query(
          `INSERT INTO scripts (id, scan_id, source_url, is_inline, artifact_path, fingerprint, detected_patterns, estimated_version, confidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            script.id,
            script.scanId,
            script.sourceUrl,
            script.isInline,
            script.artifactPath,
            script.fingerprint,
            script.detectedPatterns,
            script.estimatedVersion,
            script.confidence,
          ],
        );
      }

      for (const library of libraries) {
        await client.query(
          `INSERT INTO libraries (id, scan_id, name, detected_version, related_scripts, vulnerabilities, risk_score, confidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            library.id,
            library.scanId,
            library.name,
            library.detectedVersion,
            library.relatedScripts,
            JSON.stringify(library.vulnerabilities),
            library.riskScore,
            library.confidence,
          ],
        );
      }

      for (const finding of findings) {
        await client.query(
          `INSERT INTO findings (id, scan_id, type, title, description, severity, location, evidence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            finding.id,
            finding.scanId,
            finding.type,
            finding.title,
            finding.description,
            finding.severity,
            JSON.stringify(finding.location),
            finding.evidence,
          ],
        );
      }

      await client.query(
        `INSERT INTO ai_analysis (scan_id, threat_intelligence, risk_assessment, behavioral_analysis, predictions)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (scan_id) DO UPDATE SET
         threat_intelligence = EXCLUDED.threat_intelligence,
         risk_assessment = EXCLUDED.risk_assessment,
         behavioral_analysis = EXCLUDED.behavioral_analysis,
         predictions = EXCLUDED.predictions`,
        [
          scanId,
          JSON.stringify(aiAnalysis.threatIntelligence),
          JSON.stringify(aiAnalysis.riskAssessment),
          JSON.stringify(aiAnalysis.behavioralAnalysis),
          JSON.stringify(aiAnalysis.predictions),
        ],
      );

      for (const report of integrityReports) {
        await client.query(
          `INSERT INTO integrity_reports (scan_id, package_name, version, integrity_status, verification_method, confidence, details)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            scanId,
            report.packageName,
            report.version,
            report.integrityStatus,
            report.verificationMethod,
            report.confidence,
            JSON.stringify(report.details),
          ],
        );
      }

      await client.query(
        `INSERT INTO supply_chain_analysis (scan_id, risk_assessment, recommendations, supply_chain_map)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (scan_id) DO UPDATE SET
         risk_assessment = EXCLUDED.risk_assessment,
         recommendations = EXCLUDED.recommendations,
         supply_chain_map = EXCLUDED.supply_chain_map`,
        [
          scanId,
          JSON.stringify(supplyChainAnalysis.riskAssessment),
          JSON.stringify(supplyChainAnalysis.recommendations),
          JSON.stringify(supplyChainAnalysis.supplyChainMap),
        ],
      );

      await client.query(
        `INSERT INTO quantum_readiness (scan_id, overall_readiness, crypto_inventory, threats, migration_plan, timeline, cost_estimate)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (scan_id) DO UPDATE SET
         overall_readiness = EXCLUDED.overall_readiness,
         crypto_inventory = EXCLUDED.crypto_inventory,
         threats = EXCLUDED.threats,
         migration_plan = EXCLUDED.migration_plan,
         timeline = EXCLUDED.timeline,
         cost_estimate = EXCLUDED.cost_estimate`,
        [
          scanId,
          quantumReadiness.overallReadiness,
          JSON.stringify(quantumReadiness.cryptoInventory),
          JSON.stringify(quantumReadiness.threats),
          JSON.stringify(quantumReadiness.migrationPlan),
          JSON.stringify(quantumReadiness.timeline),
          JSON.stringify(quantumReadiness.costEstimate),
        ],
      );

      await client.query(
        `INSERT INTO analytics_reports (scan_id, type, title, generated_at, summary, sections, recommendations, charts)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          scanId,
          analyticsReport.type,
          analyticsReport.title,
          analyticsReport.generatedAt,
          JSON.stringify(analyticsReport.summary),
          JSON.stringify(analyticsReport.sections),
          JSON.stringify(analyticsReport.recommendations),
          JSON.stringify(analyticsReport.charts),
        ],
      );

      await client.query('UPDATE scans SET global_risk_score = $1 WHERE id = $2', [Math.round(globalRiskScore), scanId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
