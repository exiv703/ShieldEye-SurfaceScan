// @ts-nocheck
// Fix: replace drifted assertions with tests against the real runtime config module behavior.
type ConfigModule = typeof import('../../api/src/config');

const ORIGINAL_ENV: NodeJS.ProcessEnv = { ...process.env };

const loadConfigModule = async (): Promise<ConfigModule> => {
  jest.resetModules();
  return import('../../api/src/config');
};

describe('Config module (unit)', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('uses documented defaults when env values are not provided', async () => {
    delete process.env.PORT;
    delete process.env.DB_PORT;
    delete process.env.DB_NAME;
    delete process.env.RATE_LIMIT_MAX;
    process.env.NODE_ENV = 'test';

    const configModule = await loadConfigModule();
    const { appConfig, serverConfig } = configModule.getConfig();

    expect(serverConfig.port).toBe(3000);
    expect(appConfig.database.port).toBe(5432);
    expect(appConfig.database.database).toBe('shieldeye');
    expect(serverConfig.rateLimitMax).toBe(100);
    expect(serverConfig.enableHealthChecks).toBe(true);
  });

  it('parses valid numeric and boolean env vars from real implementation', async () => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '8081';
    process.env.RATE_LIMIT_MAX = '250';
    process.env.ENABLE_HEALTH_CHECKS = 'false';

    const configModule = await loadConfigModule();
    const { serverConfig } = configModule.getConfig();

    expect(serverConfig.port).toBe(8081);
    expect(serverConfig.rateLimitMax).toBe(250);
    expect(serverConfig.enableHealthChecks).toBe(false);
  });

  it('falls back to safe defaults for invalid numeric env vars', async () => {
    process.env.NODE_ENV = 'test';
    process.env.DB_PORT = 'not-a-number';
    process.env.REQUEST_TIMEOUT_MS = '9999999';

    const configModule = await loadConfigModule();
    const { appConfig, serverConfig } = configModule.getConfig();

    expect(appConfig.database.port).toBe(5432);
    expect(serverConfig.requestTimeoutMs).toBe(30000);
  });

  it('accepts production config when secure secrets are set', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DB_PASSWORD = 'super-secure-password';
    process.env.MINIO_SECRET_KEY = 'super-secure-minio-secret';
    process.env.CORS_ORIGIN = 'https://shield.example';

    const configModule = await loadConfigModule();

    expect(configModule.isProduction()).toBe(true);
    expect(configModule.isDevelopment()).toBe(false);
    expect(() => configModule.validateConfig()).not.toThrow();
  });

  it('rejects insecure production defaults at module validation time', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DB_PASSWORD = 'shieldeye_dev';
    process.env.MINIO_SECRET_KEY = 'shieldeye_dev';

    await expect(loadConfigModule()).rejects.toThrow('Production environment requires a secure database password');
  });
});
