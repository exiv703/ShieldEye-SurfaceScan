import { RiskCalculator, RiskLevel, FindingType, Vulnerability, Library, Finding } from '@shieldeye/shared';
import { logger } from '../logger';

export class AdvancedRiskCalculator extends RiskCalculator {
  static calculateLibraryRiskScore(
    library: {
      name: string;
      version?: string;
      vulnerabilities: Vulnerability[];
      confidence?: number;
    },
    findings: Finding[]
  ): number {
    let baseScore = 0;

    // Factor 1: Vulnerability severity and count
    if (library.vulnerabilities.length > 0) {
      const maxCvss = Math.max(...library.vulnerabilities.map(v => v.cvssScore || 0));
      const criticalCount = library.vulnerabilities.filter(v => 
        v.severity === RiskLevel.CRITICAL || (v.cvssScore && v.cvssScore >= 9.0)
      ).length;
      const highCount = library.vulnerabilities.filter(v => 
        v.severity === RiskLevel.HIGH || (v.cvssScore && v.cvssScore >= 7.0 && v.cvssScore < 9.0)
      ).length;

      baseScore = maxCvss * 10; // Scale CVSS to 0-100
      baseScore += criticalCount * 20; // Boost for critical vulnerabilities
      baseScore += highCount * 10; // Boost for high vulnerabilities
    }

    // Factor 2: Detection confidence penalty
    const confidencePenalty = (100 - (library.confidence ?? 0)) * 0.3;
    baseScore = Math.max(0, baseScore - confidencePenalty);

    // Factor 3: Library-specific findings
    const libraryFindings = findings.filter(f => 
      f.location?.scriptId && this.isLibraryScript(f.location.scriptId, library.name)
    );

    for (const finding of libraryFindings) {
      switch (finding.type) {
        case FindingType.EVAL_USAGE:
          baseScore += 25;
          break;
        case FindingType.HARDCODED_TOKEN:
          baseScore += 30;
          break;
        case FindingType.DYNAMIC_IMPORT:
          baseScore += 15;
          break;
        case FindingType.REMOTE_CODE:
          baseScore += 35;
          break;
        case FindingType.WEBASSEMBLY:
          baseScore += 20;
          break;
      }
    }

    // Factor 4: Popular library penalty (well-maintained libraries are less risky)
    const popularLibraries = ['react', 'vue', 'angular', 'jquery', 'lodash'];
    if (popularLibraries.includes(library.name.toLowerCase())) {
      baseScore *= 0.8; // 20% reduction for popular libraries
    }

    // Factor 5: Version freshness (older versions are riskier)
    if (library.version) {
      const versionAge = this.estimateVersionAge(library.name, library.version);
      if (versionAge > 365) { // More than 1 year old
        baseScore *= 1.3;
      } else if (versionAge > 180) { // More than 6 months old
        baseScore *= 1.1;
      }
    }

    return Math.min(100, Math.max(0, baseScore));
  }

  static calculateGlobalRiskScore(
    libraries: Library[],
    findings: Finding[]
  ): {
    score: number;
    level: RiskLevel;
    breakdown: {
      maxLibraryRisk: number;
      averageLibraryRisk: number;
      vulnerableLibrariesCount: number;
      criticalFindingsCount: number;
      totalVulnerabilities: number;
    };
  } {
    const libraryRisks = libraries.map(lib => lib.riskScore);
    const maxRisk = libraryRisks.length > 0 ? Math.max(...libraryRisks) : 0;
    const avgRisk = libraryRisks.length > 0 ? 
      libraryRisks.reduce((sum, risk) => sum + risk, 0) / libraryRisks.length : 0;

    const vulnerableLibraries = libraries.filter(lib => lib.vulnerabilities.length > 0);
    const criticalFindings = findings.filter(f => f.severity === RiskLevel.CRITICAL);
    const totalVulnerabilities = libraries.reduce((sum, lib) => sum + lib.vulnerabilities.length, 0);

    // Weighted calculation
    let globalScore = 0;
    
    // 40% weight on maximum library risk
    globalScore += maxRisk * 0.4;
    
    // 25% weight on average library risk
    globalScore += avgRisk * 0.25;
    
    // 20% weight on vulnerable libraries ratio
    const vulnerableRatio = libraries.length > 0 ? vulnerableLibraries.length / libraries.length : 0;
    globalScore += vulnerableRatio * 100 * 0.2;
    
    // 15% weight on critical findings
    globalScore += Math.min(criticalFindings.length * 10, 50) * 0.15;

    // Additional penalties
    if (totalVulnerabilities > 10) {
      globalScore += 10; // Penalty for many vulnerabilities
    }

    if (criticalFindings.length > 5) {
      globalScore += 15; // Penalty for many critical findings
    }

    const finalScore = Math.min(100, Math.max(0, globalScore));
    const riskLevel = this.getRiskLevel(finalScore);

    return {
      score: finalScore,
      level: riskLevel,
      breakdown: {
        maxLibraryRisk: maxRisk,
        averageLibraryRisk: avgRisk,
        vulnerableLibrariesCount: vulnerableLibraries.length,
        criticalFindingsCount: criticalFindings.length,
        totalVulnerabilities
      }
    };
  }

  static generateRiskRecommendations(
    libraries: Library[],
    findings: Finding[]
  ): Array<{
    type: 'library_update' | 'security_finding' | 'general';
    priority: 'high' | 'medium' | 'low';
    title: string;
    description: string;
    library?: string;
    finding?: Finding;
  }> {
    const recommendations: Array<{
      type: 'library_update' | 'security_finding' | 'general';
      priority: 'high' | 'medium' | 'low';
      title: string;
      description: string;
      library?: string;
      finding?: Finding;
    }> = [];

    // Library-specific recommendations
    for (const library of libraries) {
      if (library.vulnerabilities.length > 0) {
        const criticalVulns = library.vulnerabilities.filter(v => 
          v.severity === RiskLevel.CRITICAL || (v.cvssScore && v.cvssScore >= 9.0)
        );

        if (criticalVulns.length > 0) {
          recommendations.push({
            type: 'library_update',
            priority: 'high',
            title: `Critical vulnerabilities in ${library.name}`,
            description: `${library.name} has ${criticalVulns.length} critical vulnerabilities. Update to the latest version immediately.`,
            library: library.name
          });
        } else {
          recommendations.push({
            type: 'library_update',
            priority: 'medium',
            title: `Vulnerabilities in ${library.name}`,
            description: `${library.name} has ${library.vulnerabilities.length} known vulnerabilities. Consider updating to a patched version.`,
            library: library.name
          });
        }
      }

      // Low confidence detection warning
      if ((library.confidence ?? 0) < 50) {
        recommendations.push({
          type: 'general',
          priority: 'low',
          title: `Uncertain library detection: ${library.name}`,
          description: `The detection of ${library.name} has low confidence (${library.confidence}%). Manual verification recommended.`,
          library: library.name
        });
      }
    }

    // Finding-specific recommendations
    const criticalFindings = findings.filter(f => f.severity === RiskLevel.CRITICAL);
    const highFindings = findings.filter(f => f.severity === RiskLevel.HIGH);

    for (const finding of criticalFindings) {
      recommendations.push({
        type: 'security_finding',
        priority: 'high',
        title: `Critical security issue: ${finding.title}`,
        description: finding.description,
        finding
      });
    }

    for (const finding of highFindings) {
      recommendations.push({
        type: 'security_finding',
        priority: 'medium',
        title: `Security concern: ${finding.title}`,
        description: finding.description,
        finding
      });
    }

    // General recommendations
    const evalFindings = findings.filter(f => f.type === FindingType.EVAL_USAGE);
    if (evalFindings.length > 0) {
      recommendations.push({
        type: 'general',
        priority: 'high',
        title: 'Dangerous eval() usage detected',
        description: `Found ${evalFindings.length} instances of eval() usage, which can lead to code injection vulnerabilities.`
      });
    }

    const tokenFindings = findings.filter(f => f.type === FindingType.HARDCODED_TOKEN);
    if (tokenFindings.length > 0) {
      recommendations.push({
        type: 'general',
        priority: 'high',
        title: 'Hardcoded secrets detected',
        description: `Found ${tokenFindings.length} potential hardcoded secrets or tokens in the code.`
      });
    }

    return recommendations.sort((a, b) => {
      const priorityOrder: Record<'high' | 'medium' | 'low', number> = { high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }

  private static isLibraryScript(scriptId: string, libraryName: string): boolean {
    // Simple heuristic - in a real implementation, this would be more sophisticated
    return scriptId.toLowerCase().includes(libraryName.toLowerCase());
  }

  private static estimateVersionAge(libraryName: string, version: string): number {
    // Simplified version age estimation
    // In a real implementation, this would query package registries for release dates
    const versionParts = version.split('.').map(Number);
    const majorVersion = versionParts[0] || 0;
    const minorVersion = versionParts[1] || 0;

    // Very rough estimation based on version numbers
    // This is a placeholder - real implementation would use actual release dates
    const estimatedAge = Math.max(0, (new Date().getFullYear() - 2020) * 365 - (majorVersion * 180 + minorVersion * 30));
    return estimatedAge;
  }
}
