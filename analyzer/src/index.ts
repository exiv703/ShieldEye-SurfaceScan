import { config } from 'dotenv';
import { AnalysisWorker } from './worker';
import { logger } from './logger';

config();

class AnalyzerService {
  private worker: AnalysisWorker;

  constructor() {
    this.worker = new AnalysisWorker();
  }

  async start(): Promise<void> {
    try {
      await this.worker.start();
      logger.info('Analyzer service started successfully');
    } catch (error) {
      logger.error('Failed to start analyzer service', { error: error instanceof Error ? error.message : error });
      process.exit(1);
    }
  }

  async shutdown(): Promise<void> {
    try {
      await this.worker.stop();
      logger.info('Analyzer service shutdown complete');
    } catch (error) {
      logger.error('Error during analyzer service shutdown', { error: error instanceof Error ? error.message : error });
    }
  }
}

const service = new AnalyzerService();

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
  logger.error('Failed to start analyzer service', { error: error instanceof Error ? error.message : error });
  process.exit(1);
});
