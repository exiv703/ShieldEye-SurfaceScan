import { jest, beforeAll, afterAll } from '@jest/globals';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  // Ensure nothing tries to talk to real infra during unit tests
  process.env.REDIS_HOST = 'localhost';
  process.env.REDIS_PORT = '6379';
  process.env.MINIO_ENDPOINT = 'localhost:9000';
  process.env.DB_HOST = 'localhost';
  process.env.DB_PORT = '5432';
});

afterAll(() => {
  jest.useRealTimers();
});
