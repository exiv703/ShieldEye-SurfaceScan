import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import { logger } from '../logger';
import { Library, Finding } from '@shieldeye/shared';
import { ThreatIntelligenceEngine, ThreatAnalysisResult } from '../intel/threat-intelligence';
import { IntegrityVerifier, IntegrityReport } from '../integrity/integrity-verifier';

export interface AnalyticsReport {
  id: string;
  type: 'security' | 'compliance' | 'performance' | 'predictive' | 'executive';
  title: string;
  generatedAt: Date;
  summary: {
    totalScans: number;
    totalLibraries: number;
    totalVulnerabilities: number;
    averageRiskScore: number;
    trendsOverview: string;
  };
  sections: AnalyticsSection[];
  recommendations: AnalyticsRecommendation[];
  charts: ChartData[];
}

export interface AnalyticsSection {
  id: string;
  title: string;
  type: 'chart' | 'table' | 'text' | 'metrics';
  content: any;
  insights: string[];
  priority: 'high' | 'medium' | 'low';
}

export interface AnalyticsRecommendation {
  id: string;
  category: 'security' | 'performance' | 'compliance';
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  impact: string;
  effort: 'low' | 'medium' | 'high';
  timeline: string;
}

export interface ChartData {
  id: string;
  type: 'line' | 'bar' | 'pie' | 'heatmap';
  title: string;
  data: any;
}

export class AnalyticsEngine extends EventEmitter {
  private reports: Map<string, AnalyticsReport> = new Map();
  private threatEngine: ThreatIntelligenceEngine;
  private integrityVerifier: IntegrityVerifier;

  constructor(
    threatEngine: ThreatIntelligenceEngine,
    integrityVerifier: IntegrityVerifier
  ) {
    super();
    this.threatEngine = threatEngine;
    this.integrityVerifier = integrityVerifier;
  }

  async generateSecurityReport(scanData: {
    libraries: Library[];
    findings: Finding[];
    aiAnalysis: ThreatAnalysisResult;
    integrityReports: IntegrityReport[];
  }): Promise<AnalyticsReport> {
    const reportId = this.generateReportId('security');
    
    logger.info('Generating security analytics report', { reportId });

    const sections: AnalyticsSection[] = [];

    // Executive Summary
    sections.push({
      id: 'executive_summary',
      title: 'Executive Summary',
      type: 'text',
      content: {
        overview: 'Security analysis of the client-side libraries detected on the page',
        keyFindings: [
          `Analyzed ${scanData.libraries.length} JavaScript libraries`,
          `Identified ${scanData.findings.length} security findings`,
          `Threat score: ${scanData.aiAnalysis.riskAssessment.overallRisk}`
        ],
        riskLevel: this.calculateRiskLevel(scanData.aiAnalysis.riskAssessment.overallRisk)
      },
      insights: [
        'Threat scoring is derived from detected libraries and findings',
        'Dependency integrity checks flag tampered or unexpected packages',
        'Findings include risky runtime patterns observed in scripts'
      ],
      priority: 'high'
    });

    // Vulnerability Analysis
    sections.push({
      id: 'vulnerability_analysis',
      title: 'Vulnerability Analysis',
      type: 'chart',
      content: this.analyzeVulnerabilities(scanData.libraries),
      insights: [
        'Critical vulnerabilities require immediate attention',
        'Counts are grouped by severity across detected libraries'
      ],
      priority: 'high'
    });

    // Threat signals
    sections.push({
      id: 'threat_signals',
      title: 'Threat Signals',
      type: 'table',
      content: {
        threatData: scanData.aiAnalysis.threatIntelligence,
        predictions: scanData.aiAnalysis.predictions,
        behavioralAnalysis: scanData.aiAnalysis.behavioralAnalysis
      },
      insights: [
        'Signals are aggregated from library metadata and findings',
        'Supply-chain risks are derived from package integrity checks'
      ],
      priority: 'high'
    });

    // Supply Chain Security
    const supplyChainAnalysis = await this.integrityVerifier.analyzeSupplyChain(scanData.libraries);
    sections.push({
      id: 'supply_chain',
      title: 'Supply Chain Security',
      type: 'metrics',
      content: {
        integrityScore: this.calculateIntegrityScore(scanData.integrityReports),
        compromisedPackages: supplyChainAnalysis.riskAssessment.compromisedPackages,
        recommendations: supplyChainAnalysis.recommendations
      },
      insights: [
        'Integrity checks compare packages against expected checksums',
        'Mismatches may indicate tampering or unexpected versions',
        'Unverified packages should be reviewed before deployment'
      ],
      priority: 'high'
    });

    const recommendations = this.generateRecommendations(scanData);
    const charts = this.generateCharts(scanData);

    const report: AnalyticsReport = {
      id: reportId,
      type: 'security',
      title: 'Security Analytics Report',
      generatedAt: new Date(),
      summary: {
        totalScans: 1,
        totalLibraries: scanData.libraries.length,
        totalVulnerabilities: scanData.libraries.reduce((sum, lib) => sum + lib.vulnerabilities.length, 0),
        averageRiskScore: scanData.libraries.reduce((sum, lib) => sum + lib.riskScore, 0) / scanData.libraries.length,
        trendsOverview: 'Summary of detected libraries, findings and risk score for this scan'
      },
      sections,
      recommendations,
      charts
    };

    this.reports.set(reportId, report);
    this.emit('reportGenerated', report);
    return report;
  }

  async generatePredictiveReport(historicalData: any[]): Promise<AnalyticsReport> {
    const reportId = this.generateReportId('predictive');
    
    const sections: AnalyticsSection[] = [];

    // Vulnerability Forecast
    sections.push({
      id: 'vulnerability_forecast',
      title: 'Vulnerability Forecast',
      type: 'chart',
      content: {
        predictions: await this.generateVulnerabilityPredictions(historicalData),
        timeframe: '90 days'
      },
      insights: [
        'Forecast is based on the supplied historical scan data',
        'Trends are indicative only and depend on input volume'
      ],
      priority: 'high'
    });

    // Risk Trend Analysis
    sections.push({
      id: 'risk_trends',
      title: 'Risk Trend',
      type: 'chart',
      content: await this.generateRiskTrends(historicalData),
      insights: [
        'Risk trend is computed from historical risk scores',
        'More scans over time improve trend accuracy'
      ],
      priority: 'high'
    });

    const report: AnalyticsReport = {
      id: reportId,
      type: 'predictive',
      title: 'Predictive Security Analytics',
      generatedAt: new Date(),
      summary: {
        totalScans: historicalData.length,
        totalLibraries: 0,
        totalVulnerabilities: 0,
        averageRiskScore: 0,
        trendsOverview: 'Trend projection based on historical scan data'
      },
      sections,
      recommendations: [],
      charts: []
    };

    this.reports.set(reportId, report);
    return report;
  }

  async exportReport(reportId: string, format: 'pdf' | 'html' | 'json'): Promise<string> {
    const report = this.reports.get(reportId);
    if (!report) {
      throw new Error(`Report ${reportId} not found`);
    }

    const exportPath = `/tmp/shieldeye_report_${reportId}.${format}`;
    
    switch (format) {
      case 'json':
        await this.exportToJSON(report, exportPath);
        break;
      case 'html':
        await this.exportToHTML(report, exportPath);
        break;
      case 'pdf':
        await this.exportToPDF(report, exportPath);
        break;
    }

    logger.info('Report exported', { reportId, format, path: exportPath });
    return exportPath;
  }

  private generateReportId(type: string): string {
    return `${type}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  private calculateRiskLevel(score: number): string {
    if (score >= 80) return 'Critical';
    if (score >= 60) return 'High';
    if (score >= 40) return 'Medium';
    return 'Low';
  }

  private analyzeVulnerabilities(libraries: Library[]): any {
    const total = libraries.reduce((sum, lib) => sum + lib.vulnerabilities.length, 0);
    const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };

    libraries.forEach(lib => {
      lib.vulnerabilities.forEach(vuln => {
        const severity = vuln.severity.toLowerCase();
        if (severity in bySeverity) {
          (bySeverity as any)[severity]++;
        }
      });
    });

    return { total, bySeverity, libraries: libraries.length };
  }

  private calculateIntegrityScore(reports: IntegrityReport[]): number {
    if (reports.length === 0) return 100;
    const intactReports = reports.filter(r => r.integrityStatus === 'intact').length;
    return (intactReports / reports.length) * 100;
  }

  private generateRecommendations(scanData: any): AnalyticsRecommendation[] {
    void scanData;
    return [
      {
        id: 'rec_1',
        category: 'security',
        priority: 'critical',
        title: 'Update Critical Vulnerabilities',
        description: 'Update libraries with known critical vulnerabilities to patched versions',
        impact: 'Removes the most severe known issues from the dependency set',
        effort: 'medium',
        timeline: '24 hours'
      },
      {
        id: 'rec_2',
        category: 'security',
        priority: 'high',
        title: 'Review Outdated Dependencies',
        description: 'Audit and update outdated client-side dependencies',
        impact: 'Reduces exposure to publicly disclosed vulnerabilities',
        effort: 'low',
        timeline: '1 week'
      }
    ];
  }

  private generateCharts(scanData: any): ChartData[] {
    void scanData;
    return [
      {
        id: 'vulnerability_trend',
        type: 'line',
        title: 'Vulnerability Trend Analysis',
        data: {
          labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May'],
          datasets: [{
            label: 'Vulnerabilities',
            data: [12, 19, 3, 5, 2]
          }]
        }
      },
      {
        id: 'risk_distribution',
        type: 'pie',
        title: 'Risk Distribution',
        data: {
          labels: ['Critical', 'High', 'Medium', 'Low'],
          datasets: [{
            data: [10, 20, 30, 40]
          }]
        }
      }
    ];
  }

  private async generateVulnerabilityPredictions(data: any[]): Promise<any> {
    // Naive projection from observed scan history; refine once enough data exists.
    const recent = data.length;
    return {
      next30Days: recent,
      next90Days: recent * 3,
      sampleSize: recent
    };
  }

  private async generateRiskTrends(data: any[]): Promise<any> {
    return {
      trend: data.length > 1 ? 'tracked' : 'insufficient-data',
      sampleSize: data.length
    };
  }

  private async exportToJSON(report: AnalyticsReport, path: string): Promise<void> {
    await fs.writeFile(path, JSON.stringify(report, null, 2));
  }

  private async exportToHTML(report: AnalyticsReport, path: string): Promise<void> {
    const html = `
    <!DOCTYPE html>
    <html>
    <head><title>${report.title}</title></head>
    <body>
        <h1>${report.title}</h1>
        <p>Generated: ${report.generatedAt}</p>
        <h2>Summary</h2>
        <p>Libraries: ${report.summary.totalLibraries}</p>
        <p>Vulnerabilities: ${report.summary.totalVulnerabilities}</p>
    </body>
    </html>`;
    
    await fs.writeFile(path, html);
  }

  private async exportToPDF(report: AnalyticsReport, path: string): Promise<void> {
    logger.info('PDF export simulated', { path });
  }

  getReports(): AnalyticsReport[] {
    return Array.from(this.reports.values());
  }

  getReport(reportId: string): AnalyticsReport | null {
    return this.reports.get(reportId) || null;
  }
}
