/**
 * Dependency diagram:
 * AnalysisWorker -> ScanService -> AnalysisEngine
 * AnalysisEngine -> LibraryDetector/VulnerabilityFeedClient
 * AnalysisEngine -> threat / integrity / crypto / analytics engines
 */
import { v4 as uuidv4 } from 'uuid';
import {
  PatternUtils,
  FindingType,
  type Script,
  type Library,
  type Finding,
  type RiskLevel,
} from '@shieldeye/shared';
import { ScanRiskCalculator } from '../analysis/risk-calculator';
import { logger } from '../logger';

export interface AnalysisTaskInput {
  scanId: string;
  artifacts: unknown;
  domAnalysis: any;
}

export interface AnalysisTaskOutput {
  scripts: Script[];
  libraries: Library[];
  findings: Finding[];
  riskScore: number;
  aiAnalysis: any;
  integrityReports: any[];
  supplyChainAnalysis: any;
  quantumReadiness: any;
  analyticsReport: any;
}

export interface AnalysisEngineDeps {
  libraryDetector: {
    detectLibraries(content: string, sourceUrl?: string, sourceMapContent?: string): Promise<Array<{ name: string; version?: string; confidence: number }>>;
  };
  vulnerabilityClient: {
    getVulnerabilities(name: string, version?: string): Promise<any[]>;
  };
  threatEngine: {
    analyzeThreats(libraries: Library[], findings: Finding[], domAnalysis: any, artifacts: unknown): Promise<any>;
  };
  integrityVerifier: {
    verifyPackageIntegrity(name: string, version: string, content: Buffer): Promise<any>;
    analyzeSupplyChain(libraries: Library[]): Promise<any>;
  };
  cryptoAnalyzer: {
    assessCryptoPosture(libraries: Library[]): Promise<any>;
  };
  analyticsEngine: {
    generateSecurityReport(input: { libraries: Library[]; findings: Finding[]; aiAnalysis: any; integrityReports: any[] }): Promise<any>;
  };
  readObjectAsString(bucket: string, objectName: string): Promise<string>;
  generateScriptFingerprint(content: string): string;
  getFindingTitle(type: FindingType): string;
  getFindingDescription(type: FindingType, evidence: string): string;
  getFindingSeverity(type: FindingType): RiskLevel;
}

export class AnalysisEngine {
  constructor(private readonly deps: AnalysisEngineDeps) {}

  async analyze(task: AnalysisTaskInput): Promise<AnalysisTaskOutput> {
    const { scanId, artifacts, domAnalysis } = task;
    const scripts: Script[] = [];
    const libraries: Library[] = [];
    const findings: Finding[] = [];

    for (let i = 0; i < domAnalysis.scripts.inline.length; i++) {
      const inlineScript = domAnalysis.scripts.inline[i];
      const scriptId = uuidv4();
      const scriptFindings: Array<{ type: FindingType; evidence: string; line?: number }> =
        PatternUtils.detectRiskyPatterns(inlineScript.content);

      for (const pattern of scriptFindings) {
        findings.push({
          id: uuidv4(),
          scanId,
          type: pattern.type,
          title: this.deps.getFindingTitle(pattern.type),
          description: this.deps.getFindingDescription(pattern.type, pattern.evidence),
          severity: this.deps.getFindingSeverity(pattern.type),
          location: {
            scriptId,
            line: pattern.line,
          },
          evidence: pattern.evidence,
        });
      }

      const detections = await this.deps.libraryDetector.detectLibraries(inlineScript.content, undefined, undefined);

      scripts.push({
        id: scriptId,
        scanId,
        sourceUrl: undefined,
        isInline: true,
        artifactPath: `scans/${scanId}/scripts/inline-script-${i + 1}.js`,
        fingerprint: this.deps.generateScriptFingerprint(inlineScript.content),
        detectedPatterns: scriptFindings.map((f) => f.type),
        estimatedVersion: detections[0]?.version,
        confidence: detections[0]?.confidence || 0,
      });

      this.mergeDetections(scanId, scriptId, detections, libraries);
    }

    for (let i = 0; i < domAnalysis.scripts.external.length; i++) {
      const externalScript = domAnalysis.scripts.external[i];
      const scriptId = uuidv4();
      let scriptContent = '';

      try {
        const artifactPath = `scans/${scanId}/scripts/external-script-${i + 1}.js`;
        const bucket = process.env.MINIO_BUCKET || 'shieldeye-artifacts';
        scriptContent = await this.deps.readObjectAsString(bucket, artifactPath);
      } catch (error) {
        logger.warn('Could not fetch external script content', {
          scanId,
          src: externalScript.src,
          error: error instanceof Error ? error.message : error,
        });
      }

      let sourceMapContent: string | undefined;
      try {
        const smMatch = scriptContent.match(/[#@]\s*sourceMappingURL=([^\n\r]+)/);
        if (smMatch && smMatch[1]) {
          const resolvedUrl = new URL(smMatch[1].trim(), externalScript.src).href;
          const found = domAnalysis.sourceMaps.find((sm: { url: string; content?: string }) => sm.url === resolvedUrl);
          if (found?.content) {
            sourceMapContent = found.content;
          }
        }
      } catch (error) {
        logger.warn('Could not resolve source map URL for external script', {
          scanId,
          src: externalScript.src,
          error: error instanceof Error ? error.message : error,
        });
      }

      const detections = await this.deps.libraryDetector.detectLibraries(
        scriptContent,
        externalScript.src,
        sourceMapContent,
      );

      scripts.push({
        id: scriptId,
        scanId,
        sourceUrl: externalScript.src,
        isInline: false,
        artifactPath: `scans/${scanId}/scripts/external-script-${i + 1}.js`,
        fingerprint: this.deps.generateScriptFingerprint(scriptContent || externalScript.src),
        detectedPatterns: [],
        estimatedVersion: detections[0]?.version,
        confidence: detections[0]?.confidence || 0,
      });

      this.mergeDetections(scanId, scriptId, detections, libraries);
    }

    for (const library of libraries) {
      try {
        const vulnerabilities = await this.deps.vulnerabilityClient.getVulnerabilities(
          library.name,
          library.detectedVersion,
        );
        library.vulnerabilities = vulnerabilities;
        library.riskScore = Math.round(ScanRiskCalculator.calculateLibraryRiskScore(library, findings));
      } catch (error) {
        logger.warn('Failed to fetch vulnerabilities for library', {
          scanId,
          library: library.name,
          version: library.detectedVersion,
          error: error instanceof Error ? error.message : error,
        });
      }
    }

    const aiAnalysis = await this.deps.threatEngine.analyzeThreats(libraries, findings, domAnalysis, artifacts);

    const integrityReports: any[] = [];
    for (const library of libraries) {
      try {
        const mockContent = Buffer.from(`mock-content-${library.name}`);
        const integrityReport = await this.deps.integrityVerifier.verifyPackageIntegrity(
          library.name,
          library.detectedVersion || '1.0.0',
          mockContent,
        );
        integrityReports.push(integrityReport);
      } catch (error) {
        logger.warn('Integrity verification failed', { library: library.name, error });
      }
    }

    const supplyChainAnalysis = await this.deps.integrityVerifier.analyzeSupplyChain(libraries);
    const quantumReadiness = await this.deps.cryptoAnalyzer.assessCryptoPosture(libraries);
    const riskAssessment = ScanRiskCalculator.calculateGlobalRiskScore(libraries, findings);

    const analyticsReport = await this.deps.analyticsEngine.generateSecurityReport({
      libraries,
      findings,
      aiAnalysis,
      integrityReports,
    });

    return {
      scripts,
      libraries,
      findings,
      riskScore: riskAssessment.score,
      aiAnalysis,
      integrityReports,
      supplyChainAnalysis,
      quantumReadiness,
      analyticsReport,
    };
  }

  private mergeDetections(
    scanId: string,
    scriptId: string,
    detections: Array<{ name: string; version?: string; confidence: number }>,
    libraries: Library[],
  ): void {
    for (const detection of detections) {
      const existingLib = libraries.find((lib) => lib.name === detection.name);
      if (existingLib) {
        if (detection.confidence > (existingLib.confidence ?? 0)) {
          existingLib.detectedVersion = detection.version;
          existingLib.confidence = detection.confidence;
        }
        (existingLib.relatedScripts = existingLib.relatedScripts || []).push(scriptId);
      } else {
        libraries.push({
          id: uuidv4(),
          scanId,
          name: detection.name,
          detectedVersion: detection.version,
          relatedScripts: [scriptId],
          vulnerabilities: [],
          riskScore: 0,
          confidence: detection.confidence,
        });
      }
    }
  }
}
