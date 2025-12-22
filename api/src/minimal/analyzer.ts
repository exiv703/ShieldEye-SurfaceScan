import { validateTargetUrl } from '../security/url-validator';
import {
  CacheUtils,
  FingerprintUtils,
  Finding,
  FindingType,
  Library,
  PatternUtils,
  RiskCalculator,
  RiskLevel,
  ScanStatus,
  Script,
  Vulnerability,
} from '@shieldeye/shared';
import { logger } from '../logger';
import type { Database } from '../database';

const OSV_API_URL = process.env.OSV_API_URL || 'https://api.osv.dev';
const OSV_TIMEOUT_MS = parseInt(process.env.OSV_TIMEOUT || '20000', 10);
const VULN_CACHE_TTL_SECONDS = parseInt(process.env.VULN_CACHE_TTL || '86400', 10);

interface OsvVulnerability {
  id: string;
  summary?: string;
  details?: string;
  severity?: Array<{ type: string; score: string }>;
  references?: Array<{ type: string; url: string }>;
}

async function fetchWithTimeout(url: string, options: any, timeoutMs: number) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal } as any);
    return resp;
  } finally {
    clearTimeout(id);
  }
}

async function fetchLibraryVulnerabilitiesFromOsv(name: string, version?: string): Promise<OsvVulnerability[]> {
  if (!name || !OSV_API_URL) return [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OSV_TIMEOUT_MS);
  try {
    const body: any = {
      package: {
        name,
        ecosystem: 'npm',
      },
    };
    if (version) body.version = version;

    const resp = await fetch(`${OSV_API_URL.replace(/\/$/, '')}/v1/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    } as any);

    if (!resp.ok) {
      logger.warn('OSV query failed', { library: name, status: resp.status });
      return [];
    }

    const data: any = await resp.json();
    return Array.isArray(data?.vulns) ? (data.vulns as OsvVulnerability[]) : [];
  } catch (err) {
    if ((err as any)?.name === 'AbortError') {
      logger.warn('OSV query timeout', { library: name });
      return [];
    }
    logger.warn('OSV query error', { library: name, error: err instanceof Error ? err.message : String(err) });
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchHtml(url: string): Promise<{ html: string; headers: Record<string, string>; status: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const safeUrl = await validateTargetUrl(url);
    const resp = await fetch(safeUrl.toString(), { signal: controller.signal } as any);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const headers: Record<string, string> = {};
    resp.headers.forEach((value: string, key: string) => {
      headers[key.toLowerCase()] = value;
    });

    const html = await resp.text();
    return { html, headers, status: resp.status };
  } finally {
    clearTimeout(timeout);
  }
}

function extractInlineScripts(html: string): string[] {
  const scripts: string[] = [];
  const regex = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    const content = (m[1] || '').trim();
    if (content) scripts.push(content);
  }
  return scripts;
}

function mapFindingTypeToSeverity(type: FindingType): RiskLevel {
  switch (type) {
    case FindingType.HARDCODED_TOKEN:
    case FindingType.REMOTE_CODE:
      return RiskLevel.CRITICAL;
    case FindingType.EVAL_USAGE:
    case FindingType.CVE:
      return RiskLevel.HIGH;
    case FindingType.DYNAMIC_IMPORT:
    case FindingType.WEBASSEMBLY:
      return RiskLevel.MODERATE;
    default:
      return RiskLevel.LOW;
  }
}

function analyzeHtmlSurface(
  html: string,
  scan: any,
  pageProtocol: string | null,
  pageHost: string | null,
  findings: Finding[],
) {
  // Forms
  const formRegex = /<form\b[^>]*>/gi;
  const methodRegex = /\bmethod\s*=\s*["']([^"']+)["']/i;
  const inputPasswordRegex = /<input\b[^>]*type\s*=\s*["']password["'][^>]*>/gi;
  const csrfRegex = /csrf|xsrf|_token|authenticity_token/i;

  let formCount = 0;
  let getForms = 0;
  let passwordOverHttp = 0;
  let hasCsrfToken = false;

  let fm: RegExpExecArray | null;
  while ((fm = formRegex.exec(html)) !== null) {
    formCount += 1;
    const tag = fm[0];
    const mm = methodRegex.exec(tag);
    const method = (mm?.[1] || 'get').toLowerCase();
    if (method === 'get') getForms += 1;
  }

  const hasPassword = inputPasswordRegex.test(html);
  const isHttps = (pageProtocol || '').toLowerCase() === 'https:';
  if (hasPassword && !isHttps) passwordOverHttp = 1;

  if (csrfRegex.test(html)) {
    hasCsrfToken = true;
  }

  if (getForms > 0) {
    findings.push({
      scanId: scan.id,
      type: 'FORM_SECURITY' as any,
      title: 'Forms using GET method detected',
      description: 'At least one <form> uses method=GET. GET forms may leak sensitive data via URLs, logs and referrers.',
      severity: RiskLevel.MODERATE,
      location: {} as any,
      evidence: undefined,
    } as Finding);
  }

  if (passwordOverHttp > 0) {
    findings.push({
      scanId: scan.id,
      type: 'FORM_SECURITY' as any,
      title: 'Password field on a non-HTTPS page',
      description: 'A password input was detected on a page that is not served over HTTPS, which risks credential disclosure.',
      severity: RiskLevel.HIGH,
      location: {} as any,
      evidence: undefined,
    } as Finding);
  }

  if (formCount > 0 && !hasCsrfToken) {
    findings.push({
      scanId: scan.id,
      type: 'FORM_SECURITY' as any,
      title: 'Possible missing CSRF protection',
      description:
        'Forms were detected but no obvious CSRF token indicator was found. Consider adding CSRF tokens and SameSite cookies.',
      severity: RiskLevel.MODERATE,
      location: {} as any,
      evidence: undefined,
    } as Finding);
  }

  // Inline event handlers
  const eventAttrRegex = /\bon\w+\s*=\s*["']([^"']+)["']/gi;
  let totalEventHandlers = 0;
  const eventExamples: string[] = [];
  const dangerousExamples: string[] = [];

  let em: RegExpExecArray | null;
  while ((em = eventAttrRegex.exec(html)) !== null) {
    totalEventHandlers += 1;
    const handler = (em[1] || '').trim();
    if (eventExamples.length < 5) eventExamples.push(handler);

    if (/eval\s*\(/i.test(handler) || /javascript:/i.test(handler)) {
      if (dangerousExamples.length < 5) dangerousExamples.push(handler);
    }
  }

  if (totalEventHandlers > 0) {
    findings.push({
      scanId: scan.id,
      type: 'INLINE_EVENT_HANDLER' as any,
      title: 'Inline event handlers detected',
      description:
        'The HTML contains inline event handlers (e.g. onclick="...") which often correlate with weaker CSP policies and increase XSS risk.',
      severity: RiskLevel.MODERATE,
      location: {} as any,
      evidence: eventExamples.join('\n') || undefined,
    } as Finding);
  }

  if (dangerousExamples.length > 0) {
    findings.push({
      scanId: scan.id,
      type: 'INLINE_EVENT_HANDLER' as any,
      title: 'Dangerous inline handler patterns detected',
      description: 'Inline event handlers containing eval() or javascript: were detected, which are high risk patterns.',
      severity: RiskLevel.HIGH,
      location: {} as any,
      evidence: dangerousExamples.join('\n') || undefined,
    } as Finding);
  }

  // Iframes
  const iframeRegex = /<iframe\b[^>]*src=["']([^"']+)["'][^>]*>/gi;
  let thirdPartyIframeCount = 0;
  let insecureIframeCount = 0;
  const thirdPartyIframeExamples: string[] = [];
  const insecureIframeExamples: string[] = [];

  let im: RegExpExecArray | null;
  while ((im = iframeRegex.exec(html)) !== null) {
    const src = im[1];
    if (!src) continue;

    try {
      const u = new URL(src, scan.url);
      const isThirdParty = pageHost ? u.hostname !== pageHost : false;
      const isInsecure = u.protocol === 'http:';

      if (isThirdParty) {
        thirdPartyIframeCount += 1;
        if (thirdPartyIframeExamples.length < 5) thirdPartyIframeExamples.push(src);
      }
      if (isInsecure) {
        insecureIframeCount += 1;
        if (insecureIframeExamples.length < 5) insecureIframeExamples.push(src);
      }
    } catch {
      // ignore
    }
  }

  if (thirdPartyIframeCount > 0) {
    findings.push({
      scanId: scan.id,
      type: 'IFRAME_SECURITY' as any,
      title: 'Third-party iframes detected',
      description:
        'The page embeds third-party iframes. Embedded applications can expand the attack surface and may leak data to external providers.',
      severity: RiskLevel.MODERATE,
      location: {} as any,
      evidence: thirdPartyIframeExamples.join('\n') || undefined,
    } as Finding);
  }

  if (insecureIframeCount > 0) {
    findings.push({
      scanId: scan.id,
      type: 'IFRAME_SECURITY' as any,
      title: 'Iframes loaded over insecure HTTP',
      description:
        'At least one iframe is loaded over HTTP. Mixed-content iframes can be tampered with and weaken the overall security of the page.',
      severity: RiskLevel.HIGH,
      location: {} as any,
      evidence: insecureIframeExamples.join('\n') || undefined,
    } as Finding);
  }

  // Mixed content detection (images, stylesheets, and other resources loaded over HTTP on HTTPS pages)
  const isPageHttps = (pageProtocol || '').toLowerCase() === 'https:';
  if (isPageHttps) {
    const mixedScriptRegex = /<script[^>]+src=["']http:\/\/[^"']+["'][^>]*>/gi;
    const mixedImgRegex = /<img[^>]+src=["']http:\/\/[^"']+["'][^>]*>/gi;
    const mixedLinkRegex = /<link[^>]+href=["']http:\/\/[^"']+["'][^>]*>/gi;

    let scriptMatch: RegExpExecArray | null;
    let imgMatch: RegExpExecArray | null;
    let linkMatch: RegExpExecArray | null;

    let mixedScriptCount = 0;
    let mixedImgCount = 0;
    let mixedLinkCount = 0;
    const mixedScriptExamples: string[] = [];
    const mixedImgExamples: string[] = [];
    const mixedLinkExamples: string[] = [];

    while ((scriptMatch = mixedScriptRegex.exec(html)) !== null) {
      mixedScriptCount += 1;
      if (mixedScriptExamples.length < 5) mixedScriptExamples.push(scriptMatch[0]);
    }

    while ((imgMatch = mixedImgRegex.exec(html)) !== null) {
      mixedImgCount += 1;
      if (mixedImgExamples.length < 5) mixedImgExamples.push(imgMatch[0]);
    }

    while ((linkMatch = mixedLinkRegex.exec(html)) !== null) {
      mixedLinkCount += 1;
      if (mixedLinkExamples.length < 5) mixedLinkExamples.push(linkMatch[0]);
    }

    const totalMixed = mixedScriptCount + mixedImgCount + mixedLinkCount + insecureIframeCount;
    if (totalMixed > 0) {
      const hasScriptOrIframe = mixedScriptCount > 0 || insecureIframeCount > 0;
      const severity = hasScriptOrIframe ? RiskLevel.HIGH : RiskLevel.MODERATE;

      const evidenceParts: string[] = [];
      if (mixedScriptExamples.length) {
        evidenceParts.push('Scripts:\n' + mixedScriptExamples.join('\n'));
      }
      if (insecureIframeExamples.length) {
        evidenceParts.push('Iframes:\n' + insecureIframeExamples.join('\n'));
      }
      if (mixedImgExamples.length) {
        evidenceParts.push('Images:\n' + mixedImgExamples.join('\n'));
      }
      if (mixedLinkExamples.length) {
        evidenceParts.push('Links:\n' + mixedLinkExamples.join('\n'));
      }

      findings.push({
        scanId: scan.id,
        type: 'SECURITY_HEADER' as any,
        title: 'Mixed content detected on HTTPS page',
        description:
          'The page is served over HTTPS but loads some resources (scripts, iframes, images or stylesheets) over insecure HTTP. Mixed content weakens transport security and may allow tampering.',
        severity,
        location: { protocol: pageProtocol || undefined } as any,
        evidence: evidenceParts.join('\n\n') || undefined,
      } as Finding);
    }
  }
}

export async function minimalAnalyzeAndPersist(database: Database, scan: any): Promise<{ libraries: Library[]; findings: Finding[] }> {
  const existingLibraries = await database.getLibrariesByScan(scan.id);
  const existingFindings = await database.getFindingsByScan(scan.id);
  if ((existingLibraries.length > 0 || existingFindings.length > 0) && scan.status === ScanStatus.COMPLETED) {
    return { libraries: existingLibraries as any, findings: existingFindings as any };
  }

  let html: string | null = null;
  let responseHeaders: Record<string, string> = {};
  try {
    const result = await fetchHtml(scan.url);
    html = result.html;
    responseHeaders = result.headers || {};
  } catch (error) {
    logger.warn('Minimal analyzer: failed to fetch HTML', {
      url: scan.url,
      error: error instanceof Error ? error.message : error,
    });

    const finding: Omit<Finding, 'id'> = {
      scanId: scan.id,
      type: 'ERROR' as any,
      title: 'Failed to fetch target URL',
      description: `Minimal analyzer could not fetch ${scan.url}: ${error instanceof Error ? error.message : String(error)}`,
      severity: RiskLevel.MODERATE,
      location: {},
      evidence: undefined,
    };

    const findingId = await database.createFinding(finding as any);
    const savedFinding: Finding = { ...(finding as any), id: findingId };
    return { libraries: [], findings: [savedFinding] };
  }

  // Extract external script URLs from HTML
  const scriptSrcs: string[] = [];
  const scriptIntegrity: Record<string, boolean> = {};
  if (html) {
    const scriptRegex = /<script[^>]+src=["']([^"']+)["'][^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = scriptRegex.exec(html)) !== null) {
      const tag = m[0];
      const src = m[1];
      if (src) {
        if (!scriptSrcs.includes(src)) {
          scriptSrcs.push(src);
        }
        if (!(src in scriptIntegrity)) {
          const integrityMatch = /integrity=["']([^"']+)["']/i.exec(tag);
          scriptIntegrity[src] = !!integrityMatch;
        }
      }
      if (scriptSrcs.length >= 20) break;
    }
  }

  const libraries: Library[] = [];
  let thirdPartyCount = 0;
  let insecureCount = 0;
  const thirdPartyExamples: string[] = [];
  const insecureExamples: string[] = [];

  let pageHost: string | null = null;
  let pageProtocol: string | null = null;
  try {
    const parsed = new URL(scan.url);
    pageHost = parsed.hostname;
    pageProtocol = parsed.protocol;
  } catch {
    // ignore
  }

  const findings: Finding[] = [];
  if (html) {
    const inlineScripts = extractInlineScripts(html);
    inlineScripts.forEach((scriptContent, index) => {
      const scriptFindings = PatternUtils.detectRiskyPatterns(scriptContent);
      for (const f of scriptFindings) {
        const finding: Omit<Finding, 'id'> = {
          scanId: scan.id,
          type: f.type as any,
          title: `Script security pattern detected: ${FindingType[f.type] || 'Unknown'}`,
          description: `Potentially risky JavaScript pattern detected in inline script #${index + 1} at line ${f.line ?? 'unknown'}.`,
          severity: mapFindingTypeToSeverity(f.type),
          location: { scriptType: 'inline', scriptIndex: index, line: f.line } as any,
          evidence: f.evidence,
        };
        findings.push(finding as Finding);
      }
    });

    analyzeHtmlSurface(html, scan, pageProtocol, pageHost, findings);
  }

  // Analyze HTTP security headers
  try {
    const headers = Object.fromEntries(Object.entries(responseHeaders || {}).map(([k, v]) => [k.toLowerCase(), v]));
    const isHttps = (pageProtocol || '').toLowerCase() === 'https:';

    const csp = headers['content-security-policy'];
    if (!csp) {
      findings.push({
        scanId: scan.id,
        type: 'SECURITY_HEADER' as any,
        title: 'Missing Content-Security-Policy header',
        description:
          'The response does not include a Content-Security-Policy (CSP) header, which reduces protection against XSS and injection attacks.',
        severity: RiskLevel.MODERATE,
        location: { header: 'Content-Security-Policy' } as any,
        evidence: undefined,
      } as Finding);
    } else if (/unsafe-inline|unsafe-eval/i.test(csp)) {
      findings.push({
        scanId: scan.id,
        type: 'SECURITY_HEADER' as any,
        title: 'Weak Content-Security-Policy configuration',
        description:
          'The Content-Security-Policy header uses unsafe directives (unsafe-inline or unsafe-eval), which significantly weaken XSS protections.',
        severity: RiskLevel.HIGH,
        location: { header: 'Content-Security-Policy' } as any,
        evidence: csp,
      } as Finding);
    }

    const hsts = headers['strict-transport-security'];
    if (isHttps && !hsts) {
      findings.push({
        scanId: scan.id,
        type: 'SECURITY_HEADER' as any,
        title: 'Missing Strict-Transport-Security header',
        description:
          'The HTTPS response does not include a Strict-Transport-Security (HSTS) header, which makes downgrade and SSL-stripping attacks easier.',
        severity: RiskLevel.HIGH,
        location: { header: 'Strict-Transport-Security' } as any,
        evidence: undefined,
      } as Finding);
    }

    const xfo = headers['x-frame-options'];
    if (!xfo) {
      findings.push({
        scanId: scan.id,
        type: 'SECURITY_HEADER' as any,
        title: 'Missing X-Frame-Options header',
        description: 'The response does not include an X-Frame-Options header, which increases the risk of clickjacking attacks.',
        severity: RiskLevel.MODERATE,
        location: { header: 'X-Frame-Options' } as any,
        evidence: undefined,
      } as Finding);
    } else if (!/^(DENY|SAMEORIGIN)$/i.test(xfo)) {
      findings.push({
        scanId: scan.id,
        type: 'SECURITY_HEADER' as any,
        title: 'Weak X-Frame-Options configuration',
        description:
          'The X-Frame-Options header is present but uses a non-recommended value. Prefer DENY or SAMEORIGIN to mitigate clickjacking.',
        severity: RiskLevel.MODERATE,
        location: { header: 'X-Frame-Options' } as any,
        evidence: xfo,
      } as Finding);
    }

    const xcto = headers['x-content-type-options'];
    if (!xcto || xcto.toLowerCase() !== 'nosniff') {
      findings.push({
        scanId: scan.id,
        type: 'SECURITY_HEADER' as any,
        title: 'Missing or weak X-Content-Type-Options header',
        description: 'The response is missing the X-Content-Type-Options: nosniff header, which helps prevent MIME type sniffing attacks.',
        severity: RiskLevel.MODERATE,
        location: { header: 'X-Content-Type-Options' } as any,
        evidence: xcto,
      } as Finding);
    }

    const setCookie = headers['set-cookie'];
    if (setCookie) {
      const rawCookies = setCookie.split(/\r?\n/);
      let reportedSensitiveCookie = false;
      let reportedGenericCookie = false;

      for (const raw of rawCookies) {
        const trimmed = raw.trim();
        if (!trimmed) continue;

        const lower = trimmed.toLowerCase();
        const isSensitive = /session|auth|token|jwt/.test(lower);
        const hasSecure = /;\s*secure\b/i.test(trimmed);
        const hasHttpOnly = /;\s*httponly\b/i.test(trimmed);
        const hasSameSite = /;\s*samesite=/i.test(trimmed);

        if (isSensitive && (!hasSecure || !hasHttpOnly || !hasSameSite) && !reportedSensitiveCookie) {
          findings.push({
            scanId: scan.id,
            type: 'SECURITY_COOKIE' as any,
            title: 'Sensitive session/auth cookie missing security flags',
            description:
              'A session or authentication-related cookie is missing one or more of the Secure, HttpOnly or SameSite attributes, increasing the risk of theft or misuse.',
            severity: RiskLevel.HIGH,
            location: { header: 'Set-Cookie' } as any,
            evidence: trimmed,
          } as Finding);
          reportedSensitiveCookie = true;
        } else if (!isSensitive && (!hasSecure || !hasHttpOnly) && !reportedGenericCookie) {
          findings.push({
            scanId: scan.id,
            type: 'SECURITY_COOKIE' as any,
            title: 'Cookie missing Secure/HttpOnly flags',
            description:
              'At least one cookie is missing the Secure and/or HttpOnly attributes, which are recommended to reduce the risk of cookie theft.',
            severity: RiskLevel.MODERATE,
            location: { header: 'Set-Cookie' } as any,
            evidence: trimmed,
          } as Finding);
          reportedGenericCookie = true;
        }

        if (reportedSensitiveCookie && reportedGenericCookie) break;
      }
    }

    // Additional security headers
    const referrerPolicy = headers['referrer-policy'];
    if (!referrerPolicy) {
      findings.push({
        scanId: scan.id,
        type: 'SECURITY_HEADER' as any,
        title: 'Missing Referrer-Policy header',
        description:
          'The response does not include a Referrer-Policy header. This header helps control how much referrer information is exposed to third-party sites.',
        severity: RiskLevel.MODERATE,
        location: { header: 'Referrer-Policy' } as any,
        evidence: undefined,
      } as Finding);
    } else if (/unsafe-url|no-referrer-when-downgrade/i.test(referrerPolicy)) {
      findings.push({
        scanId: scan.id,
        type: 'SECURITY_HEADER' as any,
        title: 'Weak Referrer-Policy configuration',
        description:
          'The Referrer-Policy header is present but uses a permissive value that may leak sensitive URL information to third-party sites.',
        severity: RiskLevel.MODERATE,
        location: { header: 'Referrer-Policy' } as any,
        evidence: referrerPolicy,
      } as Finding);
    }

    const permissionsPolicy = headers['permissions-policy'];
    if (!permissionsPolicy) {
      findings.push({
        scanId: scan.id,
        type: 'SECURITY_HEADER' as any,
        title: 'Missing Permissions-Policy header',
        description:
          'The response does not include a Permissions-Policy header. This header can be used to restrict powerful browser features (e.g. geolocation, camera, microphone).',
        severity: RiskLevel.LOW,
        location: { header: 'Permissions-Policy' } as any,
        evidence: undefined,
      } as Finding);
    }

    const coop = headers['cross-origin-opener-policy'];
    const coep = headers['cross-origin-embedder-policy'];
    const corp = headers['cross-origin-resource-policy'];

    if (isHttps && (!coop || !/same-origin|same-origin-allow-popups/i.test(coop))) {
      findings.push({
        scanId: scan.id,
        type: 'SECURITY_HEADER' as any,
        title: 'Missing or weak Cross-Origin-Opener-Policy (COOP)',
        description:
          'The HTTPS response does not include a secure Cross-Origin-Opener-Policy (COOP). A strict COOP helps isolate the browsing context and mitigate cross-origin attacks.',
        severity: RiskLevel.LOW,
        location: { header: 'Cross-Origin-Opener-Policy' } as any,
        evidence: coop,
      } as Finding);
    }

    if (isHttps && !coep) {
      findings.push({
        scanId: scan.id,
        type: 'SECURITY_HEADER' as any,
        title: 'Missing Cross-Origin-Embedder-Policy (COEP)',
        description:
          'The HTTPS response does not include a Cross-Origin-Embedder-Policy (COEP) header. COEP is recommended for stronger cross-origin isolation and security features like SharedArrayBuffer.',
        severity: RiskLevel.LOW,
        location: { header: 'Cross-Origin-Embedder-Policy' } as any,
        evidence: coep,
      } as Finding);
    }

    if (isHttps && !corp) {
      findings.push({
        scanId: scan.id,
        type: 'SECURITY_HEADER' as any,
        title: 'Missing Cross-Origin-Resource-Policy (CORP)',
        description:
          'The HTTPS response does not include a Cross-Origin-Resource-Policy (CORP) header. CORP can help prevent other sites from loading your resources in unexpected ways.',
        severity: RiskLevel.LOW,
        location: { header: 'Cross-Origin-Resource-Policy' } as any,
        evidence: corp,
      } as Finding);
    }

    // CORS analysis
    const acao = headers['access-control-allow-origin'];
    const acac = headers['access-control-allow-credentials'];

    if (acao) {
      const originValue = acao.trim();
      const credentialsTrue = typeof acac === 'string' && acac.toLowerCase() === 'true';

      if ((originValue === '*' || originValue === '*,*') && credentialsTrue) {
        findings.push({
          scanId: scan.id,
          type: 'SECURITY_HEADER' as any,
          title: 'Insecure CORS configuration: wildcard origin with credentials',
          description:
            'The Access-Control-Allow-Origin header is set to * while Access-Control-Allow-Credentials is true. This configuration is insecure and may allow arbitrary websites to read authenticated responses.',
          severity: RiskLevel.HIGH,
          location: { header: 'Access-Control-Allow-Origin' } as any,
          evidence: `Access-Control-Allow-Origin: ${originValue}; Access-Control-Allow-Credentials: ${acac}`,
        } as Finding);
      } else if (originValue === '*') {
        findings.push({
          scanId: scan.id,
          type: 'SECURITY_HEADER' as any,
          title: 'Permissive CORS configuration: wildcard origin',
          description:
            'The Access-Control-Allow-Origin header is set to *. This may be acceptable for some public APIs, but it can be risky if sensitive data is exposed.',
          severity: RiskLevel.MODERATE,
          location: { header: 'Access-Control-Allow-Origin' } as any,
          evidence: acao,
        } as Finding);
      }
    }
  } catch (error) {
    logger.warn('Minimal analyzer: failed to analyze HTTP security headers', {
      scanId: scan.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const scriptsToInsert: Array<Omit<Script, 'id'>> = [];
  const libsToInsert: Array<Omit<Library, 'id'>> = [];

  for (const src of scriptSrcs) {
    let name = src;
    let isThirdParty = false;
    let isInsecure = false;
    let detectedVersion: string | undefined;
    try {
      const u = new URL(src, scan.url);
      const parts = u.pathname.split('/').filter(Boolean);
      const last = parts[parts.length - 1] || u.hostname;
      name = last.replace(/\.min\.js$|\.js$/i, '') || u.hostname;

      const cdnJsMatch = u.pathname.match(/\/ajax\/libs\/([^/]+)\/([^/]+)\//);
      if (cdnJsMatch) {
        name = cdnJsMatch[1];
        detectedVersion = cdnJsMatch[2];
      } else {
        const versionMatch = last.match(/(.+?)[.-]v?(\d+\.\d+\.\d+[^.]*)\.js$/i);
        if (versionMatch) {
          name = versionMatch[1];
          detectedVersion = versionMatch[2];
        }
      }

      if (pageHost) {
        isThirdParty = u.hostname !== pageHost;
      }
      isInsecure = u.protocol === 'http:';
    } catch {
      // ignore
    }

    if (isThirdParty) {
      thirdPartyCount += 1;
      if (thirdPartyExamples.length < 5) thirdPartyExamples.push(src);
    }
    if (isInsecure) {
      insecureCount += 1;
      if (insecureExamples.length < 5) insecureExamples.push(src);
    }

    const hasIntegrity = !!scriptIntegrity[src];

    if (isThirdParty && !isInsecure && !hasIntegrity) {
      findings.push({
        scanId: scan.id,
        type: 'SCRIPT_INTEGRITY' as any,
        title: 'Missing Subresource Integrity (SRI) for third-party script',
        description:
          'A third-party script is loaded over HTTPS without a Subresource Integrity (SRI) attribute, which makes it harder to detect tampering of the script at the CDN.',
        severity: RiskLevel.MODERATE,
        location: { scriptType: 'external', src } as any,
        evidence: src,
      } as Finding);
    }

    const vulnerabilities: Vulnerability[] = [];
    if (isThirdParty) {
      vulnerabilities.push({
        id: 'MINIMAL-THIRD-PARTY-SCRIPT',
        title: 'Third-party script loaded',
        description: `Script ${src} is loaded from a third-party domain and may increase supply-chain risk.`,
        severity: RiskLevel.MODERATE,
        references: [src],
      } as Vulnerability);
    }
    if (isInsecure) {
      vulnerabilities.push({
        id: 'MINIMAL-INSECURE-HTTP-SCRIPT',
        title: 'Script loaded over insecure HTTP',
        description: `Script ${src} is loaded over HTTP and could be tampered with in transit.`,
        severity: RiskLevel.HIGH,
        references: [src],
      } as Vulnerability);
    }

    let riskScore = 10;
    if (isThirdParty) riskScore += 30;
    if (isInsecure) riskScore += 40;
    if (riskScore > 100) riskScore = 100;

    const lib: Omit<Library, 'id'> = {
      scanId: scan.id,
      name,
      detectedVersion,
      relatedScripts: [src],
      vulnerabilities,
      riskScore,
      confidence: isThirdParty || isInsecure ? 70 : 50,
    };

    scriptsToInsert.push({
      scanId: scan.id,
      sourceUrl: src,
      isInline: false,
      artifactPath: `url:${src}`,
      fingerprint: FingerprintUtils.simpleHash(src),
      detectedPatterns: [],
      estimatedVersion: detectedVersion,
      confidence: isThirdParty || isInsecure ? 70 : 50,
    } as any);

    libsToInsert.push(lib);
  }

  if (scriptsToInsert.length > 0) {
    try {
      await database.createScriptsBatch(scriptsToInsert as any);
    } catch (error) {
      logger.warn('Minimal analyzer: failed to batch create script records, falling back to individual inserts', {
        scanId: scan.id,
        error: error instanceof Error ? error.message : String(error),
      });
      for (const s of scriptsToInsert) {
        try {
          await database.createScript(s as any);
        } catch (e) {
          logger.warn('Minimal analyzer: failed to create script record', {
            scanId: scan.id,
            src: (s as any).sourceUrl,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
  }

  if (libsToInsert.length > 0) {
    try {
      const ids = await database.createLibrariesBatch(libsToInsert as any);
      for (let i = 0; i < libsToInsert.length; i++) {
        libraries.push({ ...(libsToInsert[i] as any), id: ids?.[i] });
      }
    } catch (error) {
      logger.warn('Minimal analyzer: failed to batch create libraries, falling back to individual inserts', {
        scanId: scan.id,
        error: error instanceof Error ? error.message : String(error),
      });
      for (const lib of libsToInsert) {
        const libId = await database.createLibrary(lib as any);
        libraries.push({ ...(lib as any), id: libId });
      }
    }
  }

  for (const lib of libraries) {
    try {
      const versionKey = lib.detectedVersion || null;

      const cached = await database.getVulnerabilityCacheEntry(lib.name, versionKey);
      if (cached) {
        const cachedVulns = Array.isArray(cached.vulnerabilities) ? cached.vulnerabilities : [];
        if (cachedVulns.length > 0) {
          const riskInputsFromCache: Array<{ cvssScore?: number; severity: string }> = [];

          for (const v of cachedVulns as any[]) {
            const cvssScore = typeof v.cvssScore === 'number' ? v.cvssScore : undefined;
            let sevStr = 'MEDIUM';
            if (cvssScore !== undefined) {
              if (cvssScore >= 9.0) sevStr = 'CRITICAL';
              else if (cvssScore >= 7.0) sevStr = 'HIGH';
              else if (cvssScore >= 4.0) sevStr = 'MEDIUM';
              else sevStr = 'LOW';
            }
            riskInputsFromCache.push({ cvssScore, severity: sevStr });
          }

          lib.vulnerabilities = (lib.vulnerabilities || []).concat(cachedVulns as any);

          if (riskInputsFromCache.length > 0) {
            const riskFromCache = RiskCalculator.calculateLibraryRisk(riskInputsFromCache, lib.confidence ?? 50, false);
            lib.riskScore = Math.round(riskFromCache);
          }
          continue;
        }
      }

      const osvVulns = await fetchLibraryVulnerabilitiesFromOsv(lib.name, lib.detectedVersion);
      if (!osvVulns.length) continue;

      const newVulns: Vulnerability[] = lib.vulnerabilities ? [...lib.vulnerabilities] : [];
      const riskInputs: Array<{ cvssScore?: number; severity: string }> = [];

      for (const v of osvVulns) {
        let cvssScore: number | undefined;
        if (Array.isArray(v.severity) && v.severity.length > 0) {
          const s = v.severity[0];
          const parsed = parseFloat(s.score);
          if (!Number.isNaN(parsed)) cvssScore = parsed;
        }

        let sevStr = 'MEDIUM';
        if (cvssScore !== undefined) {
          if (cvssScore >= 9.0) sevStr = 'CRITICAL';
          else if (cvssScore >= 7.0) sevStr = 'HIGH';
          else if (cvssScore >= 4.0) sevStr = 'MEDIUM';
          else sevStr = 'LOW';
        }

        riskInputs.push({ cvssScore, severity: sevStr });

        const severityLevel =
          sevStr === 'CRITICAL'
            ? RiskLevel.CRITICAL
            : sevStr === 'HIGH'
            ? RiskLevel.HIGH
            : sevStr === 'LOW'
            ? RiskLevel.LOW
            : RiskLevel.MODERATE;

        const vuln: Vulnerability = {
          id: v.id,
          title: v.summary || v.id,
          description: v.details || v.summary || 'Vulnerability reported by OSV.',
          severity: severityLevel,
          cvssScore,
          references: (v.references || []).map((r) => r.url).filter(Boolean),
        } as Vulnerability;

        newVulns.push(vuln);
      }

      lib.vulnerabilities = newVulns;

      if (riskInputs.length > 0) {
        const risk = RiskCalculator.calculateLibraryRisk(riskInputs, lib.confidence ?? 50, false);
        lib.riskScore = Math.round(risk);
      }

      try {
        await database.upsertVulnerabilityCacheEntry(lib.name, versionKey, newVulns as any[], VULN_CACHE_TTL_SECONDS);
      } catch (error) {
        logger.warn('Minimal analyzer: failed to update vulnerability cache', {
          library: lib.name,
          version: lib.detectedVersion,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } catch (error) {
      logger.warn('Failed to enrich library with OSV data', {
        library: lib.name,
        version: lib.detectedVersion,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const summaryFinding: Omit<Finding, 'id'> = {
    scanId: scan.id,
    type: 'INFO' as any,
    title: 'Minimal script analysis completed',
    description: `Minimal analyzer found ${scriptSrcs.length} external script resources for ${scan.url}.`,
    severity: RiskLevel.LOW,
    location: {},
    evidence: scriptSrcs.slice(0, 5).join(', ') || undefined,
  };

  const summaryFindingId = await database.createFinding(summaryFinding as any);
  findings.push({ ...(summaryFinding as any), id: summaryFindingId });

  if (thirdPartyCount > 0 && pageHost) {
    const thirdPartyFinding: Omit<Finding, 'id'> = {
      scanId: scan.id,
      type: 'INFO' as any,
      title: 'Third-party scripts detected',
      description: `Minimal analyzer found ${thirdPartyCount} third-party script resources loaded from domains different than ${pageHost}.`,
      severity: RiskLevel.MODERATE,
      location: {},
      evidence: thirdPartyExamples.slice(0, 5).join(', ') || undefined,
    };

    const thirdPartyId = await database.createFinding(thirdPartyFinding as any);
    findings.push({ ...(thirdPartyFinding as any), id: thirdPartyId });
  }

  if (insecureCount > 0) {
    const insecureFinding: Omit<Finding, 'id'> = {
      scanId: scan.id,
      type: 'INFO' as any,
      title: 'Insecure HTTP script sources detected',
      description: `Minimal analyzer found ${insecureCount} external scripts loaded over insecure HTTP.`,
      severity: RiskLevel.HIGH,
      location: {},
      evidence: insecureExamples.slice(0, 5).join(', ') || undefined,
    };

    const insecureId = await database.createFinding(insecureFinding as any);
    findings.push({ ...(insecureFinding as any), id: insecureId });
  }

  try {
    const libraryRisks = libraries.map((l) => l.riskScore || 0);
    const criticalFindings = findings.filter((f) => f.severity === RiskLevel.CRITICAL).length;

    let globalRisk = 0;
    if (libraryRisks.length > 0) {
      globalRisk = RiskCalculator.calculateGlobalRisk(libraryRisks, criticalFindings);
      globalRisk = Math.round(globalRisk);
    }

    await database.updateScanRiskScore(scan.id, globalRisk as any);
  } catch (error) {
    logger.warn('Minimal analyzer: failed to update global risk score', {
      scanId: scan.id,
      error: error instanceof Error ? error.message : error,
    });
  }

  return { libraries, findings };
}

// Test hook (same signature as previous)
export async function __test_minimalAnalyzeAndPersist(database: Database, scan: any) {
  return minimalAnalyzeAndPersist(database, scan);
}
