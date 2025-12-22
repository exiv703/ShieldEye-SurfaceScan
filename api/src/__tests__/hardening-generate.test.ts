// @ts-nocheck
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createHardeningGenerateHandler } from '../routes/hardening';

function makeRes() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { json, status } as any;
}

describe('/api/hardening/generate handler', () => {
  let fetchWithTimeout: any;

  beforeEach(() => {
    fetchWithTimeout = jest.fn();
  });

  it('truncates context to 8000 chars and appends [truncated]', async () => {
    fetchWithTimeout.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ response: '{"ok":true}' }),
      text: async () => 'ok',
    });

    const handler = createHardeningGenerateHandler({
      llmProvider: 'ollama',
      llmBaseUrl: 'http://ollama:11434',
      llmModel: 'llama3',
      llmTemperature: 0.2,
      llmMaxTokens: 512,
      llmTimeoutMs: 1000,
      fetchWithTimeout,
    });

    const huge = 'x'.repeat(20000);
    const req = {
      body: {
        scan: { url: 'https://example.com', globalRiskScore: 10 },
        summary: { huge },
        libraries: [],
        findings: [],
      },
    } as any;

    const res = makeRes();

    await handler(req, res);

    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
    const [, options] = fetchWithTimeout.mock.calls[0];
    const parsed = JSON.parse(options.body);
    expect(parsed.model).toBe('llama3');
    expect(parsed.prompt).toContain('[truncated]');
  });

  it('returns 504 on AbortError timeout', async () => {
    const err: any = new Error('timeout');
    err.name = 'AbortError';
    fetchWithTimeout.mockRejectedValueOnce(err);

    const handler = createHardeningGenerateHandler({
      llmProvider: 'ollama',
      llmBaseUrl: 'http://ollama:11434',
      llmModel: 'llama3',
      llmTemperature: 0.2,
      llmMaxTokens: 512,
      llmTimeoutMs: 1,
      fetchWithTimeout,
    });

    const req = { body: { scan: { url: 'https://example.com' } } } as any;
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(504);
    expect(res.status().json).toHaveBeenCalledWith({ error: 'Hardening LLM request timed out' });
  });

  it('returns upstream status + details when model is missing in Ollama', async () => {
    fetchWithTimeout.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => 'model not found',
    });

    const handler = createHardeningGenerateHandler({
      llmProvider: 'ollama',
      llmBaseUrl: 'http://ollama:11434',
      llmModel: 'nonexistent',
      llmTemperature: 0.2,
      llmMaxTokens: 512,
      llmTimeoutMs: 1000,
      fetchWithTimeout,
    });

    const req = { body: { scan: { url: 'https://example.com' } } } as any;
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.status().json).toHaveBeenCalledWith({
      error: 'Hardening LLM request failed',
      details: 'model not found',
    });
  });
});
