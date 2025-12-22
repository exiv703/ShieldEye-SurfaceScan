// @ts-nocheck
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { Router, Request, Response, NextFunction } from 'express';
import { AnalyticsRoutes } from '../routes/analytics';

describe('AnalyticsRoutes', () => {
  let mockDatabase: any;
  let routes: AnalyticsRoutes;
  let router: Router;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDatabase = {
      getLibrariesCount: jest.fn().mockResolvedValue(10 as any),
      getTotalFindingsCount: jest.fn().mockResolvedValue(42 as any),
      getFindingsSeverityCounts: jest.fn().mockResolvedValue({
        critical: 5,
        high: 7,
        medium: 20,
        low: 10,
      } as any),
      getScansCount: jest.fn().mockResolvedValue(8 as any),
      getAverageRiskScore: jest.fn().mockResolvedValue(73.5 as any),
      getAverageScanDurationSeconds: jest
        .fn()
        .mockResolvedValue(12.3 as any),
      getDailyVulnerabilityTrends: jest.fn().mockResolvedValue([
        { date: '2025-01-01', count: 3 },
        { date: '2025-01-02', count: 5 },
      ] as any),
      getFindingsCountByTypes: jest.fn().mockResolvedValue(11 as any),
      getDailyScanCounts: jest
        .fn()
        .mockResolvedValue([{ date: '2025-01-01', count: 2 }] as any),
      getTopVulnerabilities: jest.fn().mockResolvedValue(
        [{ name: 'XSS', severity: 'high', count: 7 }] as any,
      ),
      listScans: jest.fn().mockResolvedValue({
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
      } as any),
    };

    routes = new AnalyticsRoutes(mockDatabase);
    router = routes.getRouter();
  });

  it('should expose /summary route that returns rich analytics payload', async () => {
    const mockReq = {} as Request;
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const mockRes = {
      json,
      status,
    } as any as Response;
    const next: NextFunction = jest.fn();

    const layer = (router.stack as any[]).find(
      (l: any) => l.route && l.route.path === '/summary',
    );

    expect(layer).toBeDefined();

    const summaryHandler = layer!.route.stack[0].handle as (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => any;

    await summaryHandler(mockReq, mockRes, next);

    expect(mockDatabase.getLibrariesCount).toHaveBeenCalled();
    expect(mockDatabase.getTotalFindingsCount).toHaveBeenCalled();
    expect(mockDatabase.getFindingsSeverityCounts).toHaveBeenCalled();
    expect(mockDatabase.getScansCount).toHaveBeenCalled();
    expect(mockDatabase.getAverageRiskScore).toHaveBeenCalled();
    expect(
      mockDatabase.getAverageScanDurationSeconds,
    ).toHaveBeenCalled();
    expect(
      mockDatabase.getDailyVulnerabilityTrends,
    ).toHaveBeenCalledWith(30);
    expect(mockDatabase.getDailyScanCounts).toHaveBeenCalledWith(7);
    expect(mockDatabase.getFindingsCountByTypes).toHaveBeenCalledWith([
      'FORM_SECURITY',
      'INLINE_EVENT_HANDLER',
      'IFRAME_SECURITY',
    ]);
    expect(mockDatabase.getTopVulnerabilities).toHaveBeenCalledWith(5);

    expect(json).toHaveBeenCalledTimes(1);
    const payload: any = json.mock.calls[0][0];

    // New rich fields
    expect(payload.totalScans).toBe(8);
    expect(payload.averageRiskScore).toBeCloseTo(73.5);
    expect(payload.avgRiskScore).toBeCloseTo(73.5);
    expect(payload.averageScanDurationSeconds).toBeCloseTo(12.3);
    expect(payload.avgScanDurationSeconds).toBeCloseTo(12.3);
    expect(payload.totalVulnerabilities).toBe(42);
    expect(payload.application_surface_findings).toBe(11);
    expect(payload.riskDistribution).toEqual({
      critical: 5,
      high: 7,
      medium: 20,
      low: 10,
    });

    expect(payload.recentScans).toEqual([
      { date: '2025-01-01', count: 2 },
    ]);

    // Backwards compatible fields
    expect(payload.libraries_analyzed).toBe(10);
    expect(payload.total_vulnerabilities).toBe(42);
    expect(payload.vulnerability_breakdown).toEqual({
      Critical: 5,
      High: 7,
      Medium: 20,
      Low: 10,
    });
    expect(payload.top_vulnerabilities).toEqual([
      { name: 'XSS', severity: 'high', count: 7 },
    ]);
  });
});

