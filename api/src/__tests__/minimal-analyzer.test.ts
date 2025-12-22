// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

let dbInstance: any;
let createFindingId = 0;

jest.mock('../security/url-validator', () => {
  return {
    validateTargetUrl: jest.fn(async (raw: string) => new URL(raw)),
  };
});

function makeHeaders(obj: Record<string, string>) {
  return {
    forEach: (cb: any) => {
      for (const [k, v] of Object.entries(obj)) cb(v, k);
    },
  };
}

describe('minimalAnalyzeAndPersist (unit)', () => {
  let __test_minimalAnalyzeAndPersist: any;

  beforeEach(async () => {
    jest.resetModules();
    createFindingId = 0;
    dbInstance = {
      getLibrariesByScan: jest.fn().mockResolvedValue([]),
      getFindingsByScan: jest.fn().mockResolvedValue([]),
      createFinding: jest.fn().mockImplementation(async () => `f-${++createFindingId}`),
      createScriptsBatch: jest.fn().mockResolvedValue([]),
      createLibrariesBatch: jest.fn().mockResolvedValue([]),
      createScript: jest.fn().mockResolvedValue('s-1'),
      createLibrary: jest.fn().mockResolvedValue('l-1'),
      getVulnerabilityCacheEntry: jest.fn().mockResolvedValue(null),
      upsertVulnerabilityCacheEntry: jest.fn().mockResolvedValue(undefined),
      updateScanRiskScore: jest.fn().mockResolvedValue(undefined),
    };

    // default fetch mock (overridden per test)
    global.fetch = jest.fn(async (url: any) => {
      // OSV queries fail fast; should be caught
      if (String(url).includes('api.osv.dev')) {
        return {
          ok: false,
          status: 500,
          text: async () => 'OSV failed',
          headers: makeHeaders({}),
        } as any;
      }
      return {
        ok: true,
        status: 200,
        text: async () => '<!doctype html><html><head></head><body></body></html>',
        headers: makeHeaders({}),
      } as any;
    });

    const mod = await import('../minimal/analyzer');
    __test_minimalAnalyzeAndPersist = mod.__test_minimalAnalyzeAndPersist;
  });

  afterEach(() => {
    (global.fetch as any)?.mockClear?.();
  });

  it('returns header findings + summary INFO even when no scripts', async () => {
    const scan = { id: 'scan-1', url: 'https://example.com', status: 'completed' };

    const { libraries, findings } = await __test_minimalAnalyzeAndPersist(dbInstance, scan);

    expect(libraries).toEqual([]);

    // should include security header findings (not persisted)
    const types = findings.map((f: any) => f.type);
    expect(types).toContain('SECURITY_HEADER');

    // summary INFO finding is persisted (has id)
    const summary = findings.find((f: any) => f.type === 'INFO' && /Minimal script analysis completed/i.test(f.title));
    expect(summary).toBeTruthy();
    expect(summary.id).toMatch(/^f-/);

    expect(dbInstance.createFinding).toHaveBeenCalledTimes(1);
    expect(dbInstance.updateScanRiskScore).toHaveBeenCalledWith('scan-1', expect.any(Number));
  });

  it('creates ERROR finding if fetchHtml fails', async () => {
    (global.fetch as any).mockImplementationOnce(async () => {
      return {
        ok: false,
        status: 500,
        text: async () => 'server error',
        headers: makeHeaders({}),
      } as any;
    });

    const scan = { id: 'scan-2', url: 'https://bad.example.com', status: 'running' };

    const { libraries, findings } = await __test_minimalAnalyzeAndPersist(dbInstance, scan);

    expect(libraries).toEqual([]);
    expect(findings.length).toBe(1);
    expect(findings[0].type).toBe('ERROR');
    expect(findings[0].id).toMatch(/^f-/);

    expect(dbInstance.createFinding).toHaveBeenCalledTimes(1);
    expect(dbInstance.createScriptsBatch).not.toHaveBeenCalled();
  });

  it('batch-inserts scripts/libraries when script tags exist', async () => {
    (global.fetch as any).mockImplementationOnce(async () => {
      return {
        ok: true,
        status: 200,
        text: async () =>
          '<!doctype html><html><head></head><body>' +
          '<script src="http://cdn.thirdparty.com/lib-1.2.3.js"></script>' +
          '</body></html>',
        headers: makeHeaders({}),
      } as any;
    });

    dbInstance.createScriptsBatch.mockResolvedValueOnce(['s-10']);
    dbInstance.createLibrariesBatch.mockResolvedValueOnce(['l-10']);

    const scan = { id: 'scan-3', url: 'https://example.com', status: 'running' };

    const { libraries, findings } = await __test_minimalAnalyzeAndPersist(dbInstance, scan);

    expect(libraries.length).toBe(1);
    expect(libraries[0].id).toBe('l-10');
    // minimal analyzer splits "lib-1.2.3.js" into name + detectedVersion
    expect(libraries[0].name).toBe('lib');
    expect(libraries[0].detectedVersion).toBe('1.2.3');
    expect(libraries[0].riskScore).toBeGreaterThanOrEqual(70);

    expect(dbInstance.createScriptsBatch).toHaveBeenCalledTimes(1);
    expect(dbInstance.createLibrariesBatch).toHaveBeenCalledTimes(1);

    // should include INFO finding about third-party/insecure scripts (persisted)
    const thirdPartyInfo = findings.find((f: any) => f.type === 'INFO' && /Third-party scripts detected/i.test(f.title));
    const insecureInfo = findings.find((f: any) => f.type === 'INFO' && /Insecure HTTP script sources detected/i.test(f.title));
    expect(thirdPartyInfo?.id).toBeTruthy();
    expect(insecureInfo?.id).toBeTruthy();
  });

  it('detects additional security headers and CORS misconfigurations', async () => {
    (global.fetch as any).mockImplementationOnce(async () => {
      return {
        ok: true,
        status: 200,
        text: async () => '<!doctype html><html><head></head><body></body></html>',
        headers: makeHeaders({
          'Referrer-Policy': 'no-referrer-when-downgrade',
          'Permissions-Policy': '',
          'Cross-Origin-Opener-Policy': 'unsafe-none',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': 'true',
        }),
      } as any;
    });

    const scan = { id: 'scan-4', url: 'https://example.com', status: 'running' };

    const { findings } = await __test_minimalAnalyzeAndPersist(dbInstance, scan);

    const titles = findings.map((f: any) => f.title);

    expect(titles).toContain('Weak Referrer-Policy configuration');
    // Permissions-Policy missing should produce a low severity finding
    expect(titles).toContain('Missing Permissions-Policy header');
    // COOP weak or missing on HTTPS
    expect(titles).toContain('Missing or weak Cross-Origin-Opener-Policy (COOP)');
    // CORS wildcard + credentials = HIGH
    expect(titles).toContain('Insecure CORS configuration: wildcard origin with credentials');
  });

  it('detects mixed content on HTTPS pages', async () => {
    (global.fetch as any).mockImplementationOnce(async () => {
      return {
        ok: true,
        status: 200,
        text: async () =>
          '<!doctype html><html><head>' +
          '</head><body>' +
          '<img src="http://insecure.example.com/image.png" />' +
          '<link rel="stylesheet" href="http://insecure.example.com/styles.css" />' +
          '<script src="http://insecure.example.com/script.js"></script>' +
          '</body></html>',
        headers: makeHeaders({}),
      } as any;
    });

    const scan = { id: 'scan-5', url: 'https://secure.example.com', status: 'running' };

    const { findings } = await __test_minimalAnalyzeAndPersist(dbInstance, scan);

    const mixed = findings.find(
      (f: any) =>
        f.type === 'SECURITY_HEADER' &&
        typeof f.title === 'string' &&
        /Mixed content detected on HTTPS page/i.test(f.title),
    );

    expect(mixed).toBeTruthy();
    // When scripts are loaded over HTTP on HTTPS page, severity should be HIGH
    expect(mixed.severity).toBe('high');
  });
});
