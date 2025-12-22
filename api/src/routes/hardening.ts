import type { Request, Response } from 'express';

export type FetchWithTimeout = (
  url: string,
  options: any,
  timeoutMs: number,
) => Promise<{ ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string> }>;

export function createHardeningGenerateHandler(opts: {
  llmProvider: string;
  llmBaseUrl: string;
  llmModel: string;
  llmTemperature: number;
  llmMaxTokens: number;
  llmTimeoutMs: number;
  fetchWithTimeout: FetchWithTimeout;
}) {
  const {
    llmProvider,
    llmBaseUrl,
    llmModel,
    llmTemperature,
    llmMaxTokens,
    llmTimeoutMs,
    fetchWithTimeout,
  } = opts;

  return async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as any;
      const scan = (body.scan || {}) as any;
      const summary = (body.summary || {}) as any;
      const libraries = Array.isArray(body.libraries) ? body.libraries : [];
      const findings = Array.isArray(body.findings) ? body.findings : [];

      const url = String(scan.url || 'the target web application');

      const libsBrief = libraries.slice(0, 30).map((lib: any) => ({
        name: String(lib.name || ''),
        detectedVersion: lib.detectedVersion ?? lib.version ?? undefined,
        riskScore: typeof lib.riskScore === 'number' ? lib.riskScore : undefined,
        relatedScripts: Array.isArray(lib.relatedScripts) ? lib.relatedScripts.slice(0, 10) : undefined,
      }));

      const findingsBrief = findings.slice(0, 30).map((f: any) => {
        let desc = String(f.description || '');
        if (desc.length > 240) {
          desc = `${desc.slice(0, 237)}...`;
        }
        return {
          title: String(f.title || ''),
          severity: String(f.severity || ''),
          type: String(f.type || ''),
          description: desc,
        };
      });

      const context = {
        scan: {
          url,
          globalRiskScore: scan.globalRiskScore,
        },
        summary,
        libraries: libsBrief,
        findings: findingsBrief,
      };

      if (llmProvider !== 'ollama') {
        return res.status(501).json({
          error: `LLM provider not supported for hardening: ${llmProvider}`,
        });
      }

      const prompt =
        'You are a senior application security engineer. Based on the scan summary, libraries and findings, ' +
        'generate a modern, safe Content-Security-Policy (CSP) and related HTTP hardening headers for the target site. ' +
        'Output JSON with the following structure:\n' +
        '{\n' +
        '  "cspHeader": "Content-Security-Policy: ...",\n' +
        '  "additionalHeaders": { "Strict-Transport-Security": "...", ... },\n' +
        '  "scriptSamples": [ "example <script> or <link> tags with SRI" ],\n' +
        '  "notes": [ "short explanation of key directives and trade-offs" ]\n' +
        '}\n' +
        'Prefer a restrictive default-src, explicit script-src and connect-src, and avoid unsafe-inline/unsafe-eval unless strictly necessary.';

      const serializedContext = JSON.stringify(context);
      const maxContextLength = 8000;
      const truncatedContext =
        serializedContext.length > maxContextLength
          ? `${serializedContext.slice(0, maxContextLength)}... [truncated]`
          : serializedContext;

      const combinedPrompt = `${prompt}\n\nScan context (JSON):\n${truncatedContext}`;

      const urlEndpoint = `${llmBaseUrl.replace(/\/$/, '')}/api/generate`;
      const bodyReq = {
        model: llmModel,
        prompt: combinedPrompt,
        stream: false,
        options: {
          temperature: llmTemperature,
          num_predict: llmMaxTokens,
        },
      };

      const llmResp = await fetchWithTimeout(
        urlEndpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyReq),
        },
        llmTimeoutMs,
      );

      if (!llmResp.ok) {
        const text = await llmResp.text();
        return res.status(llmResp.status).json({ error: 'Hardening LLM request failed', details: text });
      }

      const data: any = await llmResp.json();
      const output = data.response || data.output || '';

      return res.json({
        output,
        model: llmModel,
        source: 'hardening',
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return res.status(504).json({ error: 'Hardening LLM request timed out' });
      }
      return res.status(500).json({
        error: 'Hardening generation failed',
        details: String(err?.message || err),
      });
    }
  };
}
