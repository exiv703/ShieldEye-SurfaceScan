import { RiskLevel, FindingType } from './types';

// Risk Scoring Utilities
export class RiskCalculator {
  static calculateLibraryRisk(
    vulnerabilities: Array<{ cvssScore?: number; severity: string }>,
    confidence: number,
    hasPublicExploit: boolean = false
  ): number {
    if (vulnerabilities.length === 0) return 0;

    const maxCvss = Math.max(...vulnerabilities.map(v => v.cvssScore || 0));
    const criticalCount = vulnerabilities.filter(v => 
      v.severity === 'CRITICAL' || (v.cvssScore && v.cvssScore >= 9.0)
    ).length;

    let baseScore = maxCvss * 10; // Scale to 0-100
    
    // Adjust for confidence
    baseScore *= (confidence / 100);
    
    // Boost for critical vulnerabilities
    baseScore += criticalCount * 15;
    
    // Boost for public exploits
    if (hasPublicExploit) {
      baseScore *= 1.5;
    }

    return Math.min(100, Math.max(0, baseScore));
  }

  static calculateGlobalRisk(libraryRisks: number[], criticalFindings: number): number {
    if (libraryRisks.length === 0) return 0;

    const maxRisk = Math.max(...libraryRisks);
    const avgRisk = libraryRisks.reduce((sum, risk) => sum + risk, 0) / libraryRisks.length;
    const highRiskCount = libraryRisks.filter(risk => risk >= 70).length;

    // Weighted combination
    let globalRisk = (maxRisk * 0.4) + (avgRisk * 0.3) + (highRiskCount * 5);
    
    // Add critical findings impact
    globalRisk += criticalFindings * 10;

    return Math.min(100, Math.max(0, globalRisk));
  }

  static getRiskLevel(score: number): RiskLevel {
    if (score >= 80) return RiskLevel.CRITICAL;
    if (score >= 60) return RiskLevel.HIGH;
    if (score >= 30) return RiskLevel.MODERATE;
    return RiskLevel.LOW;
  }
}

// Version Comparison Utilities
export class VersionUtils {
  static parseVersion(version: string): number[] {
    return version.split(/[.-]/).map(part => {
      const num = parseInt(part, 10);
      return isNaN(num) ? 0 : num;
    });
  }

  static compareVersions(v1: string, v2: string): number {
    const parts1 = this.parseVersion(v1);
    const parts2 = this.parseVersion(v2);
    const maxLength = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < maxLength; i++) {
      const part1 = parts1[i] || 0;
      const part2 = parts2[i] || 0;
      
      if (part1 < part2) return -1;
      if (part1 > part2) return 1;
    }
    
    return 0;
  }

  static isVersionInRange(version: string, range: string): boolean {
    // Simple range checking - can be extended for complex semver ranges
    if (range.includes('>=')) {
      const minVersion = range.replace('>=', '').trim();
      return this.compareVersions(version, minVersion) >= 0;
    }
    
    if (range.includes('<=')) {
      const maxVersion = range.replace('<=', '').trim();
      return this.compareVersions(version, maxVersion) <= 0;
    }
    
    if (range.includes('<')) {
      const maxVersion = range.replace('<', '').trim();
      return this.compareVersions(version, maxVersion) < 0;
    }
    
    if (range.includes('>')) {
      const minVersion = range.replace('>', '').trim();
      return this.compareVersions(version, minVersion) > 0;
    }
    
    return version === range;
  }
}

// URL and Pattern Utilities
export class PatternUtils {
  static extractLibraryFromUrl(url: string): { name?: string; version?: string; confidence: number } {
    const patterns = [
      // CDN patterns with version
      /\/([a-zA-Z0-9-_.]+)[@-](\d+\.\d+\.\d+)/,
      /\/([a-zA-Z0-9-_.]+)\/(\d+\.\d+\.\d+)\//,
      // NPM-style patterns
      /node_modules\/([^\/]+)\/.*?(\d+\.\d+\.\d+)/,
      // Common library patterns
      /\/([a-zA-Z0-9-_.]+)[-.]min\.js/,
      /\/([a-zA-Z0-9-_.]+)\.js/
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return {
          name: match[1],
          version: match[2],
          confidence: match[2] ? 80 : 40
        };
      }
    }

    return { confidence: 0 };
  }

  static extractVersionFromComment(content: string): { version?: string; confidence: number } {
    const patterns = [
      /version[:\s]+(\d+\.\d+\.\d+)/i,
      /v(\d+\.\d+\.\d+)/,
      /@version\s+(\d+\.\d+\.\d+)/i,
      /\*\s+(\d+\.\d+\.\d+)\s+\*/
    ];

    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        return {
          version: match[1],
          confidence: 70
        };
      }
    }

    return { confidence: 0 };
  }

  static detectRiskyPatterns(content: string): Array<{ type: FindingType; evidence: string; line?: number }> {
    const findings: Array<{ type: FindingType; evidence: string; line?: number }> = [];
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      const trimmedLine = line.trim();

      // Detect eval usage
      if (/\beval\s*\(/.test(line)) {
        findings.push({
          type: FindingType.EVAL_USAGE,
          evidence: trimmedLine,
          line: index + 1
        });
      }

      // Detect hardcoded tokens/secrets
      if (/(?:token|key|secret|password)\s*[:=]\s*['"][a-zA-Z0-9+/]{20,}['"]/.test(line)) {
        findings.push({
          type: FindingType.HARDCODED_TOKEN,
          evidence: trimmedLine,
          line: index + 1
        });
      }

      // Detect dynamic imports
      if (/import\s*\(/.test(line)) {
        findings.push({
          type: FindingType.DYNAMIC_IMPORT,
          evidence: trimmedLine,
          line: index + 1
        });
      }

      // Detect WebAssembly usage
      if (/WebAssembly\.instantiate/.test(line)) {
        findings.push({
          type: FindingType.WEBASSEMBLY,
          evidence: trimmedLine,
          line: index + 1
        });
      }

      // Detect common DOM-based XSS sinks / insecure HTML injection patterns
      if (
        /(innerHTML|outerHTML)\s*=/.test(line) ||
        /insertAdjacentHTML\s*\(/.test(line) ||
        /document\.write(?:ln)?\s*\(/.test(line)
      ) {
        findings.push({
          type: FindingType.DOM_XSS_SINK,
          evidence: trimmedLine,
          line: index + 1
        });
      }
    });

    return findings;
  }
}

// Fingerprinting Utilities
export class FingerprintUtils {
  static generateStructuralFingerprint(ast: any): string {
    // Simplified AST fingerprinting - would need proper AST parser in real implementation
    const features = {
      functionCount: 0,
      variableCount: 0,
      callExpressions: 0,
      stringLiterals: 0
    };

    // This would be implemented with a proper AST walker
    // For now, return a simple hash based on content structure
    const content = JSON.stringify(ast);
    return this.simpleHash(content);
  }

  static simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  static compareFingerprints(fp1: string, fp2: string): number {
    // Simple similarity comparison - could be enhanced with more sophisticated algorithms
    if (fp1 === fp2) return 100;
    
    const commonChars = fp1.split('').filter(char => fp2.includes(char)).length;
    const totalChars = Math.max(fp1.length, fp2.length);
    
    return (commonChars / totalChars) * 100;
  }
}

// Cache Utilities
export class CacheUtils {
  static isExpired(lastUpdated: Date, ttlSeconds: number): boolean {
    const now = new Date();
    const expiryTime = new Date(lastUpdated.getTime() + (ttlSeconds * 1000));
    return now > expiryTime;
  }

  static generateCacheKey(packageName: string, version?: string): string {
    return `vuln:${packageName}${version ? `:${version}` : ''}`;
  }
}

// Enhanced Validation Utilities with comprehensive error handling
export class EnhancedValidationUtils {
  static isValidUrl(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      return ['http:', 'https:'].includes(parsedUrl.protocol);
    } catch {
      return false;
    }
  }

  static sanitizeFilename(filename: string): string {
    return filename.replace(/[^a-zA-Z0-9.-]/g, '_').substring(0, 255);
  }

  static maskSecrets(content: string): string {
    return content.replace(
      /(?:token|key|secret|password|api[_-]?key)\s*[:=]\s*['"]([a-zA-Z0-9+/]{8})[a-zA-Z0-9+/]*['"/]/gi,
      (match, prefix) => match.replace(new RegExp(prefix + '[a-zA-Z0-9+/]*'), prefix + '***')
    );
  }

  static validateUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  static sanitizeInput(input: string, maxLength: number = 1000): string {
    return input.trim().replace(/[<>\"'&]/g, '').substring(0, maxLength);
  }

  static validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= 254;
  }

  static validatePort(port: number): boolean {
    return Number.isInteger(port) && port >= 1 && port <= 65535;
  }

  static validateTimeout(timeout: number): boolean {
    return Number.isInteger(timeout) && timeout >= 1000 && timeout <= 300000;
  }
}

// Performance monitoring utilities
export class PerformanceUtils {
  static measureExecutionTime<T>(fn: () => Promise<T>): Promise<{ result: T; executionTimeMs: number }> {
    const startTime = Date.now();
    return fn().then(result => ({
      result,
      executionTimeMs: Date.now() - startTime
    }));
  }

  static createTimeoutPromise<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => 
        setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
      )
    ]);
  }

  static debounce<T extends (...args: any[]) => any>(func: T, waitMs: number): T {
    let timeoutId: NodeJS.Timeout;
    return ((...args: Parameters<T>) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func(...args), waitMs);
    }) as T;
  }

  static throttle<T extends (...args: any[]) => any>(func: T, limitMs: number): T {
    let inThrottle: boolean;
    return ((...args: Parameters<T>) => {
      if (!inThrottle) {
        func(...args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limitMs);
      }
    }) as T;
  }
}

// Enhanced retry utilities
export class RetryUtils {
  static async withRetry<T>(
    operation: () => Promise<T>,
    maxAttempts: number = 3,
    delayMs: number = 1000,
    backoffMultiplier: number = 2
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt === maxAttempts) {
          throw lastError;
        }
        
        const delay = delayMs * Math.pow(backoffMultiplier, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError!;
  }

  static isRetryableError(error: Error): boolean {
    const retryableErrors = [
      'ECONNRESET',
      'ENOTFOUND',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'NETWORK_ERROR',
      'TIMEOUT_ERROR'
    ];
    
    return retryableErrors.some(code => 
      error.message.includes(code) || error.name.includes(code)
    );
  }
}
