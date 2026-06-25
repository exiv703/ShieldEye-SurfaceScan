// Krok 2.2: Integration tests for analysis_engine
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AnalysisEngine, type AnalysisEngineDeps, type AnalysisTaskInput } from '../services/analysis_engine';

type DetectLibrariesFn = AnalysisEngineDeps['libraryDetector']['detectLibraries'];
type GetVulnerabilitiesFn = AnalysisEngineDeps['vulnerabilityClient']['getVulnerabilities'];
type AnalyzeThreatsFn = AnalysisEngineDeps['threatEngine']['analyzeThreats'];
type VerifyIntegrityFn = AnalysisEngineDeps['integrityVerifier']['verifyPackageIntegrity'];
type AnalyzeSupplyChainFn = AnalysisEngineDeps['integrityVerifier']['analyzeSupplyChain'];
type AssessCryptoFn = AnalysisEngineDeps['cryptoAnalyzer']['assessCryptoPosture'];
type GenerateReportFn = AnalysisEngineDeps['analyticsEngine']['generateSecurityReport'];
type ReadObjectFn = AnalysisEngineDeps['readObjectAsString'];
type FingerprintFn = AnalysisEngineDeps['generateScriptFingerprint'];
type GetFindingTitleFn = AnalysisEngineDeps['getFindingTitle'];
type GetFindingDescriptionFn = AnalysisEngineDeps['getFindingDescription'];
type GetFindingSeverityFn = AnalysisEngineDeps['getFindingSeverity'];

interface AnalysisEngineHarness {
  engine: AnalysisEngine;
  detectLibrariesMock: jest.MockedFunction<DetectLibrariesFn>;
  getVulnerabilitiesMock: jest.MockedFunction<GetVulnerabilitiesFn>;
  analyzeThreatsMock: jest.MockedFunction<AnalyzeThreatsFn>;
  verifyIntegrityMock: jest.MockedFunction<VerifyIntegrityFn>;
  analyzeSupplyChainMock: jest.MockedFunction<AnalyzeSupplyChainFn>;
  assessCryptoMock: jest.MockedFunction<AssessCryptoFn>;
  generateReportMock: jest.MockedFunction<GenerateReportFn>;
  readObjectMock: jest.MockedFunction<ReadObjectFn>;
  fingerprintMock: jest.MockedFunction<FingerprintFn>;
}

const createTask = (): AnalysisTaskInput => ({
  scanId: 'scan-001',
  artifacts: { pageUrl: 'https://example.com' },
  domAnalysis: {
    scripts: {
      inline: [{ content: 'window.__X = 1;' }],
      external: [{ src: 'https://cdn.example.com/react.min.js' }],
    },
    sourceMaps: [
      {
        url: 'https://cdn.example.com/react.min.js.map',
        content: '{"version":3,"sources":["react.js"]}',
      },
    ],
  },
});

const createHarness = (): AnalysisEngineHarness => {
  const detectLibrariesMock: jest.MockedFunction<DetectLibrariesFn> = jest.fn<DetectLibrariesFn>();
  const getVulnerabilitiesMock: jest.MockedFunction<GetVulnerabilitiesFn> = jest.fn<GetVulnerabilitiesFn>();
  const analyzeThreatsMock: jest.MockedFunction<AnalyzeThreatsFn> = jest.fn<AnalyzeThreatsFn>();
  const verifyIntegrityMock: jest.MockedFunction<VerifyIntegrityFn> = jest.fn<VerifyIntegrityFn>();
  const analyzeSupplyChainMock: jest.MockedFunction<AnalyzeSupplyChainFn> = jest.fn<AnalyzeSupplyChainFn>();
  const assessCryptoMock: jest.MockedFunction<AssessCryptoFn> = jest.fn<AssessCryptoFn>();
  const generateReportMock: jest.MockedFunction<GenerateReportFn> = jest.fn<GenerateReportFn>();
  const readObjectMock: jest.MockedFunction<ReadObjectFn> = jest.fn<ReadObjectFn>();
  const fingerprintMock: jest.MockedFunction<FingerprintFn> = jest.fn<FingerprintFn>();
  const getFindingTitleMock: jest.MockedFunction<GetFindingTitleFn> = jest.fn<GetFindingTitleFn>();
  const getFindingDescriptionMock: jest.MockedFunction<GetFindingDescriptionFn> = jest.fn<GetFindingDescriptionFn>();
  const getFindingSeverityMock: jest.MockedFunction<GetFindingSeverityFn> = jest.fn<GetFindingSeverityFn>();

  const deps: AnalysisEngineDeps = {
    libraryDetector: { detectLibraries: detectLibrariesMock },
    vulnerabilityClient: { getVulnerabilities: getVulnerabilitiesMock },
    threatEngine: { analyzeThreats: analyzeThreatsMock },
    integrityVerifier: {
      verifyPackageIntegrity: verifyIntegrityMock,
      analyzeSupplyChain: analyzeSupplyChainMock,
    },
    cryptoAnalyzer: { assessCryptoPosture: assessCryptoMock },
    analyticsEngine: { generateSecurityReport: generateReportMock },
    readObjectAsString: readObjectMock,
    generateScriptFingerprint: fingerprintMock,
    getFindingTitle: getFindingTitleMock,
    getFindingDescription: getFindingDescriptionMock,
    getFindingSeverity: getFindingSeverityMock,
  };

  return {
    engine: new AnalysisEngine(deps),
    detectLibrariesMock,
    getVulnerabilitiesMock,
    analyzeThreatsMock,
    verifyIntegrityMock,
    analyzeSupplyChainMock,
    assessCryptoMock,
    generateReportMock,
    readObjectMock,
    fingerprintMock,
  };
};

describe('AnalysisEngine integration orchestration', () => {
  let harness: AnalysisEngineHarness;

  beforeEach(() => {
    harness = createHarness();
  });

  it('runs happy path with detection merging and risk calculation', async () => {
    const task = createTask();

    harness.readObjectMock.mockResolvedValue('//# sourceMappingURL=react.min.js.map\nwindow.React = {};');
    harness.fingerprintMock
      .mockReturnValueOnce('fp-inline')
      .mockReturnValueOnce('fp-external');

    harness.detectLibrariesMock
      .mockResolvedValueOnce([{ name: 'react', version: '17.0.0', confidence: 60 }])
      .mockResolvedValueOnce([
        { name: 'react', version: '18.2.0', confidence: 95 },
        { name: 'lodash', version: '4.17.21', confidence: 88 },
      ]);

    harness.getVulnerabilitiesMock.mockImplementation(
      async (name: string): Promise<any[]> => {
        if (name === 'react') {
          return [{ id: 'CVE-react', severity: 'critical', cvssScore: 9.8 }];
        }
        return [{ id: 'CVE-lodash', severity: 'medium', cvssScore: 5.4 }];
      },
    );

    harness.analyzeThreatsMock.mockResolvedValue({ riskAssessment: { overallRisk: 'high' } });
    harness.verifyIntegrityMock.mockResolvedValue({ integrityStatus: 'verified' });
    harness.analyzeSupplyChainMock.mockResolvedValue({ riskAssessment: { level: 'medium' } });
    harness.assessCryptoMock.mockResolvedValue({ overallReadiness: 'moderate' });
    harness.generateReportMock.mockResolvedValue({ type: 'security', title: 'Generated report' });

    const result = await harness.engine.analyze(task);

    expect(result.scripts).toHaveLength(2);
    expect(result.libraries).toHaveLength(2);

    const reactLibrary = result.libraries.find((lib) => lib.name === 'react');
    expect(reactLibrary).toBeDefined();
    expect(reactLibrary?.detectedVersion).toBe('18.2.0');
    expect(reactLibrary?.confidence).toBe(95);
    expect(reactLibrary?.relatedScripts).toHaveLength(2);
    expect(reactLibrary?.vulnerabilities).toHaveLength(1);
    expect((reactLibrary?.riskScore ?? 0)).toBeGreaterThan(0);

    expect(harness.detectLibrariesMock).toHaveBeenNthCalledWith(1, 'window.__X = 1;', undefined, undefined);
    expect(harness.detectLibrariesMock).toHaveBeenNthCalledWith(
      2,
      '//# sourceMappingURL=react.min.js.map\nwindow.React = {};',
      'https://cdn.example.com/react.min.js',
      '{"version":3,"sources":["react.js"]}',
    );

    expect(harness.getVulnerabilitiesMock).toHaveBeenCalledWith('react', '18.2.0');
    expect(harness.getVulnerabilitiesMock).toHaveBeenCalledWith('lodash', '4.17.21');
    expect(harness.verifyIntegrityMock).toHaveBeenCalledTimes(2);
    expect(result.integrityReports).toHaveLength(2);
    expect(result.riskScore).toBeGreaterThan(0);
    expect(result.aiAnalysis).toEqual({ riskAssessment: { overallRisk: 'high' } });
    expect(result.analyticsReport).toEqual({ type: 'security', title: 'Generated report' });
  });

  it('continues when vulnerability and integrity providers fail for some libraries', async () => {
    const task = createTask();

    harness.readObjectMock.mockResolvedValue('window.React = {};');
    harness.fingerprintMock.mockReturnValue('fp-any');

    harness.detectLibrariesMock
      .mockResolvedValueOnce([{ name: 'react', version: '18.2.0', confidence: 90 }])
      .mockResolvedValueOnce([]);

    harness.getVulnerabilitiesMock.mockRejectedValue(new Error('provider unavailable'));
    harness.analyzeThreatsMock.mockResolvedValue({ riskAssessment: { overallRisk: 'low' } });
    harness.verifyIntegrityMock.mockRejectedValue(new Error('integrity service unavailable'));
    harness.analyzeSupplyChainMock.mockResolvedValue({ riskAssessment: { level: 'low' } });
    harness.assessCryptoMock.mockResolvedValue({ overallReadiness: 'high' });
    harness.generateReportMock.mockResolvedValue({ type: 'security', title: 'Fallback report' });

    const result = await harness.engine.analyze(task);

    expect(result.libraries).toHaveLength(1);
    expect(result.libraries[0].name).toBe('react');
    expect(result.libraries[0].vulnerabilities).toEqual([]);
    expect(result.integrityReports).toEqual([]);
    expect(result.analyticsReport).toEqual({ type: 'security', title: 'Fallback report' });
  });
});
