import { LibraryDetection, PatternUtils, FingerprintUtils } from '@shieldeye/shared';
import { parse } from 'acorn';
import { simple as walkSimple } from 'acorn-walk';
import { SourceMapConsumer } from 'source-map';
import { logger } from '../logger';

export class LibraryDetector {
  private knownLibraries: Map<string, LibrarySignature[]> = new Map();

  constructor() {
    this.initializeKnownLibraries();
  }

  private initializeKnownLibraries(): void {
    // Initialize with common library signatures
    const commonLibraries: Array<{ name: string; signatures: LibrarySignature[] }> = [
      {
        name: 'react',
        signatures: [
          { pattern: /React\.createElement/, confidence: 90, method: 'ast_pattern' },
          { pattern: /react@(\d+\.\d+\.\d+)/, confidence: 95, method: 'url_pattern' },
          { pattern: /\/\*\*\s*@license React/, confidence: 85, method: 'comment' }
        ]
      },
      {
        name: 'jquery',
        signatures: [
          { pattern: /jQuery\.fn\.jquery\s*=\s*["'](\d+\.\d+\.\d+)["']/, confidence: 95, method: 'version_string' },
          { pattern: /jquery[.-](\d+\.\d+\.\d+)/, confidence: 90, method: 'url_pattern' },
          { pattern: /\$\.fn\.jquery/, confidence: 80, method: 'ast_pattern' }
        ]
      },
      {
        name: 'lodash',
        signatures: [
          { pattern: /lodash[.-](\d+\.\d+\.\d+)/, confidence: 90, method: 'url_pattern' },
          { pattern: /\._\.VERSION\s*=\s*["'](\d+\.\d+\.\d+)["']/, confidence: 95, method: 'version_string' },
          { pattern: /function\s+_\s*\(/, confidence: 70, method: 'ast_pattern' }
        ]
      },
      {
        name: 'angular',
        signatures: [
          { pattern: /angular[.-](\d+\.\d+\.\d+)/, confidence: 90, method: 'url_pattern' },
          { pattern: /angular\.version\s*=\s*{[^}]*full:\s*["'](\d+\.\d+\.\d+)["']/, confidence: 95, method: 'version_string' },
          { pattern: /angular\.module/, confidence: 85, method: 'ast_pattern' }
        ]
      },
      {
        name: 'vue',
        signatures: [
          { pattern: /vue[.-](\d+\.\d+\.\d+)/, confidence: 90, method: 'url_pattern' },
          { pattern: /Vue\.version\s*=\s*["'](\d+\.\d+\.\d+)["']/, confidence: 95, method: 'version_string' },
          { pattern: /Vue\.component/, confidence: 85, method: 'ast_pattern' }
        ]
      },
      {
        name: 'bootstrap',
        signatures: [
          { pattern: /bootstrap[.-](\d+\.\d+\.\d+)/, confidence: 90, method: 'url_pattern' },
          { pattern: /Bootstrap\s+v(\d+\.\d+\.\d+)/, confidence: 90, method: 'comment' }
        ]
      },
      {
        name: 'moment',
        signatures: [
          { pattern: /moment[.-](\d+\.\d+\.\d+)/, confidence: 90, method: 'url_pattern' },
          { pattern: /moment\.version\s*=\s*["'](\d+\.\d+\.\d+)["']/, confidence: 95, method: 'version_string' },
          { pattern: /moment\(\)/, confidence: 80, method: 'ast_pattern' }
        ]
      }
    ];

    for (const lib of commonLibraries) {
      this.knownLibraries.set(lib.name, lib.signatures);
    }
  }

  async detectLibraries(
    scriptContent: string,
    sourceUrl?: string,
    sourceMap?: string
  ): Promise<LibraryDetection[]> {
    const detections: LibraryDetection[] = [];

    try {
      // Method 1: URL-based detection
      if (sourceUrl) {
        const urlDetection = this.detectFromUrl(sourceUrl);
        if (urlDetection) {
          detections.push(urlDetection);
        }
      }

      // Method 2: Comment-based detection
      const commentDetections = this.detectFromComments(scriptContent);
      detections.push(...commentDetections);

      // Method 3: Source map-based detection
      if (sourceMap) {
        const sourceMapDetections = await this.detectFromSourceMap(sourceMap);
        detections.push(...sourceMapDetections);
      }

      // Method 4: AST-based detection
      const astDetections = this.detectFromAST(scriptContent);
      detections.push(...astDetections);

      // Method 5: Version string detection
      const versionDetections = this.detectVersionStrings(scriptContent);
      detections.push(...versionDetections);

      // Consolidate and rank detections
      return this.consolidateDetections(detections);

    } catch (error) {
      logger.error('Error detecting libraries', { 
        error: error instanceof Error ? error.message : error,
        sourceUrl 
      });
      return [];
    }
  }

  private detectFromUrl(url: string): LibraryDetection | null {
    const urlResult = PatternUtils.extractLibraryFromUrl(url);
    if (urlResult.name && urlResult.confidence > 0) {
      return {
        name: urlResult.name,
        version: urlResult.version,
        confidence: urlResult.confidence,
        detectionMethod: 'url_pattern',
        evidence: {
          urlPattern: url
        }
      };
    }
    return null;
  }

  private detectFromComments(content: string): LibraryDetection[] {
    const detections: LibraryDetection[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < Math.min(lines.length, 50); i++) {
      const line = lines[i];
      
      // Check for version in comments
      const versionResult = PatternUtils.extractVersionFromComment(line);
      if (versionResult.version) {
        // Try to match with known libraries
        for (const [libName, signatures] of this.knownLibraries) {
          for (const sig of signatures) {
            if (sig.method === 'comment' && sig.pattern.test(line)) {
              const match = line.match(sig.pattern);
              detections.push({
                name: libName,
                version: match?.[1] || versionResult.version,
                confidence: Math.min(sig.confidence, versionResult.confidence),
                detectionMethod: 'comment',
                evidence: {
                  comments: [line.trim()]
                }
              });
            }
          }
        }
      }
    }

    return detections;
  }

  private async detectFromSourceMap(sourceMapContent: string): Promise<LibraryDetection[]> {
    const detections: LibraryDetection[] = [];

    try {
      const sourceMap = JSON.parse(sourceMapContent);
      const consumer = await new SourceMapConsumer(sourceMap);

      // Analyze source map sources for library patterns
      if (sourceMap.sources) {
        for (const source of sourceMap.sources) {
          if (source.includes('node_modules')) {
            const match = source.match(/node_modules\/([^\/]+)/);
            if (match) {
              const packageName = match[1];
              // Try to extract version from path
              const versionMatch = source.match(/node_modules\/[^\/]+@(\d+\.\d+\.\d+)/);
              
              detections.push({
                name: packageName,
                version: versionMatch?.[1],
                confidence: 85,
                detectionMethod: 'sourcemap',
                evidence: {
                  sourceMap: source
                }
              });
            }
          }
        }
      }

      consumer.destroy();
    } catch (error) {
      logger.warn('Failed to parse source map', { error: error instanceof Error ? error.message : error });
    }

    return detections;
  }

  private detectFromAST(content: string): LibraryDetection[] {
    const detections: LibraryDetection[] = [];

    try {
      const ast = parse(content, {
        ecmaVersion: 2020,
        sourceType: 'script',
        allowHashBang: true,
        allowReturnOutsideFunction: true
      });

      // Generate structural fingerprint
      const fingerprint = FingerprintUtils.generateStructuralFingerprint(ast);

      // Walk AST to find library-specific patterns
      const features = {
        functionCalls: new Set<string>(),
        objectAccesses: new Set<string>(),
        literals: new Set<string>()
      };

      walkSimple(ast, {
        CallExpression(node: any) {
          if (node.callee?.name) {
            features.functionCalls.add(node.callee.name);
          }
          if (node.callee?.object?.name && node.callee?.property?.name) {
            features.objectAccesses.add(`${node.callee.object.name}.${node.callee.property.name}`);
          }
        },
        MemberExpression(node: any) {
          if (node.object?.name && node.property?.name) {
            features.objectAccesses.add(`${node.object.name}.${node.property.name}`);
          }
        },
        Literal(node: any) {
          if (typeof node.value === 'string' && node.value.length < 100) {
            features.literals.add(node.value);
          }
        }
      });

      // Match against known library signatures
      for (const [libName, signatures] of this.knownLibraries) {
        for (const sig of signatures) {
          if (sig.method === 'ast_pattern') {
            // Check if pattern matches any of the extracted features
            const patternStr = sig.pattern.source;
            const hasMatch = Array.from(features.functionCalls).some(call => sig.pattern.test(call)) ||
                           Array.from(features.objectAccesses).some(access => sig.pattern.test(access)) ||
                           Array.from(features.literals).some(literal => sig.pattern.test(literal));

            if (hasMatch) {
              detections.push({
                name: libName,
                confidence: sig.confidence,
                detectionMethod: 'ast_analysis',
                evidence: {
                  astFingerprint: fingerprint
                }
              });
            }
          }
        }
      }

    } catch (error) {
      logger.warn('Failed to parse JavaScript for AST analysis', { 
        error: error instanceof Error ? error.message : error 
      });
    }

    return detections;
  }

  private detectVersionStrings(content: string): LibraryDetection[] {
    const detections: LibraryDetection[] = [];

    for (const [libName, signatures] of this.knownLibraries) {
      for (const sig of signatures) {
        if (sig.method === 'version_string') {
          const match = content.match(sig.pattern);
          if (match) {
            detections.push({
              name: libName,
              version: match[1],
              confidence: sig.confidence,
              detectionMethod: 'version_string',
              evidence: {
                comments: [match[0]]
              }
            });
          }
        }
      }
    }

    return detections;
  }

  private consolidateDetections(detections: LibraryDetection[]): LibraryDetection[] {
    const consolidated = new Map<string, LibraryDetection>();

    for (const detection of detections) {
      const key = detection.name;
      const existing = consolidated.get(key);

      if (!existing) {
        consolidated.set(key, detection);
      } else {
        // Merge detections for the same library
        const mergedConfidence = Math.max(existing.confidence, detection.confidence);
        const mergedVersion = existing.version || detection.version;
        
        consolidated.set(key, {
          name: detection.name,
          version: mergedVersion,
          confidence: mergedConfidence,
          detectionMethod: `${existing.detectionMethod},${detection.detectionMethod}`,
          evidence: {
            ...existing.evidence,
            ...detection.evidence
          }
        });
      }
    }

    return Array.from(consolidated.values())
      .sort((a, b) => b.confidence - a.confidence);
  }
}

interface LibrarySignature {
  pattern: RegExp;
  confidence: number;
  method: 'url_pattern' | 'comment' | 'version_string' | 'ast_pattern' | 'sourcemap';
}
