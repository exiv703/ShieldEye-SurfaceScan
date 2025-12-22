// @ts-nocheck
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { Router, Request, Response, NextFunction } from 'express';
import { ScanRoutes } from '../routes/scans';

describe('ScanRoutes - surface endpoint', () => {
  let mockDatabase: any;
  let mockTaskQueue: any;
  let routes: ScanRoutes;
  let router: Router;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDatabase = {
      getScan: jest.fn().mockResolvedValue({
        id: 'scan-1',
        url: 'https://example.com',
        status: 'completed',
        createdAt: new Date('2025-01-01T00:00:00Z'),
        startedAt: new Date('2025-01-01T00:00:10Z'),
        completedAt: new Date('2025-01-01T00:01:00Z'),
        globalRiskScore: 75,
        parameters: {},
        artifactPaths: {},
      }),
      getFindingsByScan: jest.fn().mockResolvedValue([
        {
          id: 'f1',
          scanId: 'scan-1',
          type: 'FORM_SECURITY',
          title: 'Form uses GET',
          description: 'Example',
          severity: 'moderate',
        },
        {
          id: 'f2',
          scanId: 'scan-1',
          type: 'INLINE_EVENT_HANDLER',
          title: 'Inline onclick',
          description: 'Example',
          severity: 'high',
        },
        {
          id: 'f3',
          scanId: 'scan-1',
          type: 'IFRAME_SECURITY',
          title: 'Third-party iframe',
          description: 'Example',
          severity: 'moderate',
        },
        {
          id: 'f4',
          scanId: 'scan-1',
          type: 'SECURITY_HEADER',
          title: 'Missing CSP',
          description: 'Example',
          severity: 'high',
        },
        {
          id: 'f5',
          scanId: 'scan-1',
          type: 'SECURITY_COOKIE',
          title: 'Insecure cookie',
          description: 'Example',
          severity: 'high',
        },
        {
          id: 'f6',
          scanId: 'scan-1',
          type: 'INFO',
          title: 'Summary',
          description: 'Example',
          severity: 'low',
        },
      ]),
      // Unused in this test but required by ScanRoutes constructor in general
      createScan: jest.fn(),
      listScans: jest.fn(),
      deleteScan: jest.fn(),
    };

    mockTaskQueue = {
      addScanJob: jest.fn(),
      getScanJobStatus: jest.fn(),
    };

    routes = new ScanRoutes(mockDatabase, mockTaskQueue);
    router = routes.getRouter();
  });

  it('should group findings into surface categories', async () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const res = {
      json,
      status,
    } as any as Response;

    const req = {
      params: { id: 'scan-1' },
    } as any as Request;
    const next: NextFunction = jest.fn();

    const layer = (router.stack as any[]).find(
      (l: any) => l.route && l.route.path === '/:id/surface',
    );

    expect(layer).toBeDefined();

    const handler = layer!.route.stack[0].handle as (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => any;

    await handler(req, res, next);

    expect(mockDatabase.getScan).toHaveBeenCalledWith('scan-1');
    expect(mockDatabase.getFindingsByScan).toHaveBeenCalledWith('scan-1');

    expect(json).toHaveBeenCalledTimes(1);
    const payload = json.mock.calls[0][0] as any;

    expect(payload.scan.id).toBe('scan-1');
    expect(payload.stats.totalFindings).toBe(6);

    expect(payload.stats.categories.forms).toBe(1);
    expect(payload.stats.categories.inlineEventHandlers).toBe(1);
    expect(payload.stats.categories.iframes).toBe(1);
    expect(payload.stats.categories.securityHeaders).toBe(1);
    expect(payload.stats.categories.securityCookies).toBe(1);
    expect(payload.stats.categories.other).toBe(1);

    expect(payload.categories.forms).toHaveLength(1);
    expect(payload.categories.inlineEventHandlers).toHaveLength(1);
    expect(payload.categories.iframes).toHaveLength(1);
    expect(payload.categories.securityHeaders).toHaveLength(1);
    expect(payload.categories.securityCookies).toHaveLength(1);
    expect(payload.categories.other).toHaveLength(1);
  });

  it('should not crash and return empty categories when findings list is empty', async () => {
    mockDatabase.getFindingsByScan.mockResolvedValueOnce([]);

    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const res = { json, status } as any as Response;

    const req = { params: { id: 'scan-1' } } as any as Request;
    const next: NextFunction = jest.fn();

    const layer = (router.stack as any[]).find(
      (l: any) => l.route && l.route.path === '/:id/surface',
    );
    const handler = layer!.route.stack[0].handle as any;

    await handler(req, res, next);

    const payload = json.mock.calls[0][0] as any;
    expect(payload.stats.totalFindings).toBe(0);
    expect(payload.stats.categories.forms).toBe(0);
    expect(payload.stats.categories.inlineEventHandlers).toBe(0);
    expect(payload.stats.categories.iframes).toBe(0);
    expect(payload.stats.categories.securityHeaders).toBe(0);
    expect(payload.stats.categories.securityCookies).toBe(0);
    expect(payload.stats.categories.other).toBe(0);
  });
});

