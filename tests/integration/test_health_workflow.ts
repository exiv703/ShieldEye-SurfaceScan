// @ts-nocheck
import type { Database } from '../../api/src/database';
import type { TaskQueue } from '../../api/src/queue';

const redisClientMock = {
  ping: jest.fn<Promise<string>, []>(),
  info: jest.fn<Promise<string>, [string?]>(),
  disconnect: jest.fn<void, []>()
};

const minioClientMock = {
  bucketExists: jest.fn<Promise<boolean>, [string]>(),
  putObject: jest.fn<Promise<void>, [string, string, Buffer]>(),
  removeObject: jest.fn<Promise<void>, [string, string]>()
};

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => redisClientMock);
}, { virtual: true });

jest.mock('minio', () => {
  return {
    Client: jest.fn().mockImplementation(() => minioClientMock)
  };
}, { virtual: true });

import { HealthChecker } from '../../api/src/health';

type PoolStats = {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  isHealthy: boolean;
};

type QueueHealth = Record<string, boolean>;

type QueueStats = {
  scan: {
    active: number;
    waiting: number;
    delayed: number;
  };
};

type QueueMetrics = {
  errorRate: number;
  throughputPerHour: number;
  avgProcessingTime: number;
};

type DatabaseMock = {
  getPoolStats: jest.Mock<PoolStats, []>;
  ping: jest.Mock<Promise<void>, []>;
};

type QueueMock = {
  healthCheck: jest.Mock<Promise<QueueHealth>, []>;
  getDetailedQueueStats: jest.Mock<Promise<QueueStats>, []>;
  getMetrics: jest.Mock<QueueMetrics, []>;
};

const createDatabaseMock = (): DatabaseMock => ({
  getPoolStats: jest.fn<PoolStats, []>(() => ({
    totalCount: 4,
    idleCount: 2,
    waitingCount: 0,
    isHealthy: true
  })),
  ping: jest.fn<Promise<void>, []>(async () => undefined)
});

const createQueueMock = (): QueueMock => ({
  healthCheck: jest.fn<Promise<QueueHealth>, []>(async () => ({
    scan: true,
    analysis: true
  })),
  getDetailedQueueStats: jest.fn<Promise<QueueStats>, []>(async () => ({
    scan: {
      active: 0,
      waiting: 0,
      delayed: 0
    }
  })),
  getMetrics: jest.fn<QueueMetrics, []>(() => ({
    errorRate: 0,
    throughputPerHour: 20,
    avgProcessingTime: 15
  }))
});

type MockResponse = {
  set: jest.Mock<MockResponse, [Record<string, string>]>;
  status: jest.Mock<MockResponse, [number]>;
  json: jest.Mock<MockResponse, [unknown]>;
};

type RequestLike = {
  query: Record<string, string | undefined>;
  id: string;
};

const createResponseMock = (): MockResponse => {
  const response = {} as MockResponse;
  response.set = jest.fn<MockResponse, [Record<string, string>]>(() => response);
  response.status = jest.fn<MockResponse, [number]>(() => response);
  response.json = jest.fn<MockResponse, [unknown]>(() => response);
  return response;
};

// Fix: replace mock-object-only tests with real HealthChecker workflow tests using mocked infrastructure boundaries.
describe('Health workflow integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisClientMock.ping.mockResolvedValue('PONG');
    redisClientMock.info.mockResolvedValue('used_memory:1024\r\nused_memory_peak:2048\r\n');
    minioClientMock.bucketExists.mockResolvedValue(true);
    minioClientMock.putObject.mockResolvedValue();
    minioClientMock.removeObject.mockResolvedValue();
  });

  it('returns healthy status when all dependency checks pass', async () => {
    const database = createDatabaseMock();
    const queue = createQueueMock();
    const checker = new HealthChecker(database as unknown as Database, queue as unknown as TaskQueue);

    const result = await checker.performHealthCheck(false);

    expect(result.status).toBe('healthy');
    expect(result.checks.database.status).toBe('pass');
    expect(result.checks.redis.status).toBe('pass');
    expect(result.checks.minio.status).toBe('pass');
    expect(result.checks.queue.status).toBe('pass');
  });

  it('returns unhealthy status when a core dependency fails', async () => {
    const database = createDatabaseMock();
    const queue = createQueueMock();
    redisClientMock.ping.mockRejectedValue(new Error('Redis unavailable'));

    const checker = new HealthChecker(database as unknown as Database, queue as unknown as TaskQueue);
    const result = await checker.performHealthCheck(false);

    expect(result.status).toBe('unhealthy');
    expect(result.checks.redis.status).toBe('fail');
  });

  it('uses cached health result for repeated requests', async () => {
    const database = createDatabaseMock();
    const queue = createQueueMock();
    const checker = new HealthChecker(database as unknown as Database, queue as unknown as TaskQueue);

    const first = await checker.performHealthCheck(true);
    const second = await checker.performHealthCheck(true);

    expect(first.timestamp).toBe(second.timestamp);
    expect(database.ping).toHaveBeenCalledTimes(1);
  });

  it('healthHandler returns 200 and emits health payload for healthy state', async () => {
    const database = createDatabaseMock();
    const queue = createQueueMock();
    const checker = new HealthChecker(database as unknown as Database, queue as unknown as TaskQueue);

    const req = { query: {}, id: 'req-1' } as RequestLike;
    const res = createResponseMock();

    await checker.healthHandler(req as any, res as any);

    expect(res.set).toHaveBeenCalledWith(expect.objectContaining({ 'Cache-Control': 'public, max-age=30' }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'healthy' }));
  });
});
