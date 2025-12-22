import { config } from 'dotenv';
import { z } from 'zod';
import { AppConfig } from '@shieldeye/shared';

config();

const DatabaseConfigSchema = z.object({
  host: z.string().min(1, 'Database host is required'),
  port: z.number().int().min(1).max(65535, 'Database port must be between 1 and 65535'),
  database: z.string().min(1, 'Database name is required'),
  username: z.string().min(1, 'Database username is required'),
  password: z.string().min(1, 'Database password is required')
});

const RedisConfigSchema = z.object({
  host: z.string().min(1, 'Redis host is required'),
  port: z.number().int().min(1).max(65535, 'Redis port must be between 1 and 65535'),
  password: z.string().optional()
});

const MinioConfigSchema = z.object({
  endpoint: z.string().min(1, 'MinIO endpoint is required'),
  accessKey: z.string().min(1, 'MinIO access key is required'),
  secretKey: z.string().min(1, 'MinIO secret key is required'),
  bucket: z.string().min(1, 'MinIO bucket is required')
});

const VulnerabilityFeedsConfigSchema = z.object({
  osv: z.object({
    baseUrl: z.string().url('OSV API URL must be valid'),
    timeout: z.number().int().min(1000).max(300000, 'OSV timeout must be between 1s and 5min')
  }),
  nvd: z.object({
    baseUrl: z.string().url('NVD API URL must be valid'),
    apiKey: z.string().optional(),
    timeout: z.number().int().min(1000).max(300000, 'NVD timeout must be between 1s and 5min')
  })
});

const AppConfigSchema = z.object({
  database: DatabaseConfigSchema,
  redis: RedisConfigSchema,
  minio: MinioConfigSchema,
  vulnerabilityFeeds: VulnerabilityFeedsConfigSchema
});

const ServerConfigSchema = z.object({
  port: z.number().int().min(1).max(65535, 'Server port must be between 1 and 65535'),
  nodeEnv: z.enum(['development', 'production', 'test'], {
    errorMap: () => ({ message: 'NODE_ENV must be development, production, or test' })
  }),
  corsOrigin: z.string().min(1, 'CORS origin is required'),
  rateLimitWindowMs: z.number().int().min(60000, 'Rate limit window must be at least 1 minute'),
  rateLimitMax: z.number().int().min(1, 'Rate limit max must be at least 1'),
  requestTimeoutMs: z.number().int().min(1000).max(300000, 'Request timeout must be between 1s and 5min'),
  maxRequestSize: z.string().regex(/^\d+[kmg]?b$/i, 'Max request size must be in format like 10mb'),
  logLevel: z.enum(['error', 'warn', 'info', 'debug'], {
    errorMap: () => ({ message: 'Log level must be error, warn, info, or debug' })
  }),
  enableMetrics: z.boolean(),
  enableHealthChecks: z.boolean(),
  shutdownTimeoutMs: z.number().int().min(1000).max(60000, 'Shutdown timeout must be between 1s and 60s')
});

function parseIntWithValidation(value: string | undefined, defaultValue: number, min?: number, max?: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) return defaultValue;
  if (min !== undefined && parsed < min) return defaultValue;
  if (max !== undefined && parsed > max) return defaultValue;
  return parsed;
}

function parseBooleanWithDefault(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}

const rawAppConfig: AppConfig = {
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseIntWithValidation(process.env.DB_PORT, 5432, 1, 65535),
    database: process.env.DB_NAME || 'shieldeye',
    username: process.env.DB_USER || 'shieldeye',
    password: process.env.DB_PASSWORD || 'shieldeye_dev'
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseIntWithValidation(process.env.REDIS_PORT, 6379, 1, 65535),
    password: process.env.REDIS_PASSWORD
  },
  minio: {
    endpoint: process.env.MINIO_ENDPOINT || 'localhost:9000',
    accessKey: process.env.MINIO_ACCESS_KEY || 'shieldeye',
    secretKey: process.env.MINIO_SECRET_KEY || 'shieldeye_dev',
    bucket: process.env.MINIO_BUCKET || 'shieldeye-artifacts'
  },
  vulnerabilityFeeds: {
    osv: {
      baseUrl: process.env.OSV_API_URL || 'https://api.osv.dev',
      timeout: parseIntWithValidation(process.env.OSV_TIMEOUT, 30000, 1000, 300000)
    },
    nvd: {
      baseUrl: process.env.NVD_API_URL || 'https://services.nvd.nist.gov/rest/json',
      apiKey: process.env.NVD_API_KEY,
      timeout: parseIntWithValidation(process.env.NVD_TIMEOUT, 30000, 1000, 300000)
    }
  }
};

const rawServerConfig = {
  port: parseIntWithValidation(process.env.PORT, 3000, 1, 65535),
  nodeEnv: (process.env.NODE_ENV || 'development') as 'development' | 'production' | 'test',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  rateLimitWindowMs: parseIntWithValidation(process.env.RATE_LIMIT_WINDOW_MS, 900000, 60000),
  rateLimitMax: parseIntWithValidation(process.env.RATE_LIMIT_MAX, 100, 1),
  requestTimeoutMs: parseIntWithValidation(process.env.REQUEST_TIMEOUT_MS, 30000, 1000, 300000),
  maxRequestSize: process.env.MAX_REQUEST_SIZE || '10mb',
  logLevel: (process.env.LOG_LEVEL || 'info') as 'error' | 'warn' | 'info' | 'debug',
  enableMetrics: parseBooleanWithDefault(process.env.ENABLE_METRICS, true),
  enableHealthChecks: parseBooleanWithDefault(process.env.ENABLE_HEALTH_CHECKS, true),
  shutdownTimeoutMs: parseIntWithValidation(process.env.SHUTDOWN_TIMEOUT_MS, 10000, 1000, 60000)
};

function validateConfig() {
  try {
    const validatedAppConfig = AppConfigSchema.parse(rawAppConfig);
    const validatedServerConfig = ServerConfigSchema.parse(rawServerConfig);
    
    // Additional custom validations
    if (validatedServerConfig.nodeEnv === 'production') {
      if (!process.env.DB_PASSWORD || process.env.DB_PASSWORD === 'shieldeye_dev') {
        throw new Error('Production environment requires a secure database password');
      }
      if (!process.env.MINIO_SECRET_KEY || process.env.MINIO_SECRET_KEY === 'shieldeye_dev') {
        throw new Error('Production environment requires a secure MinIO secret key');
      }
      if (validatedServerConfig.corsOrigin === '*') {
        console.warn('WARNING: CORS is set to allow all origins in production. Consider restricting this.');
      }
    }
    
    return { appConfig: validatedAppConfig, serverConfig: validatedServerConfig };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors.map(err => `${err.path.join('.')}: ${err.message}`);
      throw new Error(`Configuration validation failed:\n${errorMessages.join('\n')}`);
    }
    throw error;
  }
}

const { appConfig, serverConfig } = validateConfig();

export { appConfig, serverConfig };

export { validateConfig };

export const getConfig = () => ({ appConfig, serverConfig });
export const isProduction = () => serverConfig.nodeEnv === 'production';
export const isDevelopment = () => serverConfig.nodeEnv === 'development';
export const isTest = () => serverConfig.nodeEnv === 'test';

export const configUtils = {
  isProduction,
  isDevelopment,
  isTest,
  
  getEnvironmentSpecificConfig: () => {
    const baseConfig = {
      database: {
        ...appConfig.database,
        ssl: serverConfig.nodeEnv === 'production'
      },
      logging: {
        level: serverConfig.logLevel,
        enableConsole: !configUtils.isProduction(),
        enableFile: true
      },
      security: {
        enableHelmet: true,
        enableCors: true,
        enableRateLimit: true,
        strictRateLimit: configUtils.isProduction()
      },
      performance: {
        enableCompression: configUtils.isProduction(),
        enableCaching: configUtils.isProduction(),
        maxConcurrentRequests: configUtils.isProduction() ? 1000 : 100
      }
    };
    
    return baseConfig;
  },
  
  validateRequiredSecrets: () => {
    const requiredSecrets = [];
    
    if (configUtils.isProduction()) {
      if (!process.env.DB_PASSWORD || process.env.DB_PASSWORD === 'shieldeye_dev') {
        requiredSecrets.push('DB_PASSWORD');
      }
      if (!process.env.MINIO_SECRET_KEY || process.env.MINIO_SECRET_KEY === 'shieldeye_dev') {
        requiredSecrets.push('MINIO_SECRET_KEY');
      }
      if (process.env.REDIS_PASSWORD === undefined) {
        console.warn('WARNING: Redis password not set in production');
      }
    }
    
    if (requiredSecrets.length > 0) {
      throw new Error(`Missing required secrets for ${serverConfig.nodeEnv} environment: ${requiredSecrets.join(', ')}`);
    }
  },
  
  logConfigSummary: () => {
    console.log('ShieldEye API Configuration Summary:');
    console.log(`- Environment: ${serverConfig.nodeEnv}`);
    console.log(`- Port: ${serverConfig.port}`);
    console.log(`- Database: ${appConfig.database.host}:${appConfig.database.port}/${appConfig.database.database}`);
    console.log(`- Redis: ${appConfig.redis.host}:${appConfig.redis.port}`);
    console.log(`- MinIO: ${appConfig.minio.endpoint}/${appConfig.minio.bucket}`);
    console.log(`- Log Level: ${serverConfig.logLevel}`);
    console.log(`- Metrics Enabled: ${serverConfig.enableMetrics}`);
    console.log(`- Health Checks Enabled: ${serverConfig.enableHealthChecks}`);
  }
};
