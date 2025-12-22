import { z } from 'zod';

// Simple types for web dependency scanner

// String-valued enum to allow both type and value usage
export enum RiskLevel {
  LOW = 'low',
  MODERATE = 'moderate',
  HIGH = 'high',
  CRITICAL = 'critical',
}

// Finding type enum used by utils
export enum FindingType {
  // Core
  EVAL_USAGE = 'EVAL_USAGE',
  HARDCODED_TOKEN = 'HARDCODED_TOKEN',
  DYNAMIC_IMPORT = 'DYNAMIC_IMPORT',
  WEBASSEMBLY = 'WEBASSEMBLY',
  // Web security sinks / DOM-based XSS
  DOM_XSS_SINK = 'DOM_XSS_SINK',
  // Minimal analyzer & HTML surface analysis
  FORM_SECURITY = 'FORM_SECURITY',
  INLINE_EVENT_HANDLER = 'INLINE_EVENT_HANDLER',
  IFRAME_SECURITY = 'IFRAME_SECURITY',
  SECURITY_HEADER = 'SECURITY_HEADER',
  SECURITY_COOKIE = 'SECURITY_COOKIE',
  SCRIPT_INTEGRITY = 'SCRIPT_INTEGRITY',
  INFO = 'INFO',
  ERROR = 'ERROR',
  // Extended (used by analyzer)
  CVE = 'CVE',
  REMOTE_CODE = 'REMOTE_CODE',
  AI_THREAT = 'AI_THREAT',
  BLOCKCHAIN_INTEGRITY = 'BLOCKCHAIN_INTEGRITY',
  SUPPLY_CHAIN_ATTACK = 'SUPPLY_CHAIN_ATTACK',
  QUANTUM_VULNERABILITY = 'QUANTUM_VULNERABILITY',
  BEHAVIORAL_ANOMALY = 'BEHAVIORAL_ANOMALY',
}

export interface ScanRequest {
  url: string;
  renderJavaScript?: boolean;
  // Extended options to align with API expectations
  scanType?: 'basic' | 'comprehensive' | 'ai-enhanced';
  options?: {
    timeout?: number; // seconds
    depth?: number;
  };
  crawlDepth?: number; // legacy
  timeout?: number; // legacy (ms)
  userAgent?: string;
  headers?: Record<string, string>;
}

// Use enum for ScanStatus values
export enum ScanStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export interface Scan {
  id: string;
  url: string;
  parameters: ScanRequest | Record<string, any>;
  status: ScanStatus;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  globalRiskScore: number;
  artifactPaths: Record<string, any>;
  error?: string;
}

export interface Library {
  id: string;
  scanId: string;
  name: string;
  detectedVersion?: string;
  relatedScripts: string[];
  vulnerabilities: Vulnerability[];
  riskScore: number;
  confidence?: number;
}

export interface Vulnerability {
  id: string;
  cveId?: string;
  osvId?: string;
  title: string;
  description: string;
  severity: RiskLevel;
  cvssScore?: number;
  fixedVersion?: string;
  affectedVersions?: string[];
  publishedAt?: Date;
  references?: string[];
}

export interface Finding {
  id: string;
  scanId: string;
  type?: string;
  title: string;
  description: string;
  severity: RiskLevel;
  location?: {
    scriptId?: string;
    line?: number;
    column?: number;
  };
  evidence?: string;
}

export interface ScanResponse {
  id: string;
  status: ScanStatus;
  url: string;
  createdAt: string;
  globalRiskScore?: number;
}

export interface ScanResultResponse {
  scan: Scan;
  libraries: Library[];
  findings: Finding[];
  summary: {
    totalLibraries: number;
    vulnerableLibraries: number;
    totalVulnerabilities: number;
    criticalFindings: number;
    riskDistribution: Record<RiskLevel, number>;
  };
  diagnostics?: {
    scripts?: {
      total: number;
      inline: number;
      external: number;
    };
    libraries?: {
      total: number;
      vulnerable: number;
      osvVulnerabilities: number;
    };
    partialScan?: boolean;
    anomalies?: string[];
    qualityScore?: number;
  };
}

// Script entity captured from renderer/analyzer
export interface Script {
  id: string;
  scanId: string;
  sourceUrl?: string;
  isInline: boolean;
  artifactPath: string;
  fingerprint: string;
  detectedPatterns: string[];
  estimatedVersion?: string;
  confidence: number;
}

// Detection emitted by analyzer's library detector
export interface LibraryDetection {
  name: string;
  version?: string;
  confidence: number;
  detectionMethod: string;
  evidence?: Record<string, any>;
}

// Queue task and result types
export interface ScanTask {
  scanId: string;
  url: string;
  parameters: ScanRequest | Record<string, any>;
  createdAt: Date;
}

export interface TaskResult {
  scanId: string;
  success: boolean;
  artifacts?: {
    domSnapshot?: string;
    networkTrace?: string;
    scripts?: string[];
    [key: string]: any;
  };
  error?: string;
}

// Cache entry used by analyzer for vulnerability feeds
export interface VulnerabilityCache {
  packageName: string;
  version: string;
  vulnerabilities: Vulnerability[];
  lastUpdated: Date;
  ttl: number; // seconds
}

// Application configuration (used by API config)
export interface AppConfig {
  database: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  minio: {
    endpoint: string; // host:port
    accessKey: string;
    secretKey: string;
    bucket: string;
  };
  vulnerabilityFeeds: {
    osv: { baseUrl: string; timeout: number };
    nvd: { baseUrl: string; apiKey?: string; timeout: number };
  };
}

// Zod schema exported for request validation in API
export const ScanRequestSchema = z.object({
  url: z.string().url(),
  renderJavaScript: z.boolean().optional().default(true),
  scanType: z.enum(['basic', 'comprehensive', 'ai-enhanced']).optional().default('comprehensive'),
  options: z.object({
    timeout: z.number().int().min(1).max(3600).optional(), // seconds
    depth: z.number().int().min(0).max(10).optional(),
  }).optional(),
  // Legacy fields tolerated for compatibility
  crawlDepth: z.number().int().optional(),
  timeout: z.number().int().optional(),
  userAgent: z.string().optional(),
  headers: z.record(z.string()).optional(),
});

// Types for renderer outputs
export interface NetworkResource {
  url: string;
  type: string;
  method: string;
  status: number;
  size: number;
  responseHeaders: Record<string, string>;
  timing: { startTime: number; endTime: number; duration: number };
}

export interface DOMAnalysis {
  scripts: {
    inline: Array<{ content: string; attributes: Record<string, string> }>;
    external: Array<{ src: string; attributes: Record<string, string> }>;
  };
  sourceMaps: Array<{ url: string; content?: string }>;
  resources: NetworkResource[];
}
