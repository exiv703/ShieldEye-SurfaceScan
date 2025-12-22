// @ts-nocheck
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

let lookupMock: any;
let validateTargetUrl: any;

describe('validateTargetUrl (anti-SSRF)', () => {
  beforeEach(async () => {
    jest.resetModules();

    lookupMock = jest.fn();

    jest.doMock('dns', () => ({
      __esModule: true,
      default: {
        promises: {
          lookup: (...args: any[]) => lookupMock(...args),
        },
      },
      promises: {
        lookup: (...args: any[]) => lookupMock(...args),
      },
    }));

    const mod = await import('../security/url-validator');
    validateTargetUrl = mod.validateTargetUrl;
  });

  it('rejects invalid URLs', async () => {
    await expect(validateTargetUrl('not a url')).rejects.toThrow('Invalid URL');
  });

  it('rejects unsupported protocols', async () => {
    await expect(validateTargetUrl('ftp://example.com/file')).rejects.toThrow('Unsupported URL protocol');
  });

  it('rejects localhost without DNS lookup', async () => {
    await expect(validateTargetUrl('http://localhost:3000/health')).rejects.toThrow(
      'Access to local addresses is not allowed',
    );
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('rejects private IP resolved via DNS', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }]);

    await expect(validateTargetUrl('https://example.com')).rejects.toThrow(
      'Access to private or internal network addresses is not allowed',
    );
  });

  it('allows public hosts', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);

    const url = await validateTargetUrl('https://example.com/path');
    expect(url).toBeInstanceOf(URL);
    expect(url.hostname).toBe('example.com');
    expect(url.protocol).toBe('https:');
  });

  it('reports DNS resolution errors (ENOTFOUND)', async () => {
    const err: any = new Error('not found');
    err.code = 'ENOTFOUND';
    lookupMock.mockRejectedValueOnce(err);

    await expect(validateTargetUrl('https://example.com')).rejects.toThrow(
      'Failed to resolve target host: example.com',
    );
  });
});
