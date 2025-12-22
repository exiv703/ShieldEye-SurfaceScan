import { config } from 'dotenv';
import { RenderWorker } from './worker';
import { logger } from './logger';

config();

class RendererService {
  private worker: RenderWorker;

  constructor() {
    this.worker = new RenderWorker();
  }

  async start(): Promise<void> {
    try {
      await this.worker.initialize();
      logger.info('Renderer service started successfully');
    } catch (error) {
      logger.error('Failed to start renderer service', { error: error instanceof Error ? error.message : error });
      process.exit(1);
    }
  }

  async shutdown(): Promise<void> {
    try {
      await this.worker.shutdown();
      logger.info('Renderer service shutdown complete');
    } catch (error) {
      logger.error('Error during renderer service shutdown', { error: error instanceof Error ? error.message : error });
    }
  }
}

const service = new RendererService();

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  await service.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await service.shutdown();
  process.exit(0);
});

// Start the service
service.start().catch((error) => {
  logger.error('Failed to start renderer service', { error: error instanceof Error ? error.message : error });
  process.exit(1);
});
