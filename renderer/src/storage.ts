import { Client } from 'minio';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger';

export class StorageManager {
  private client: Client;
  private bucketName: string;

  constructor(config: {
    endpoint: string;
    accessKey: string;
    secretKey: string;
    bucket: string;
  }) {
    this.client = new Client({
      endPoint: config.endpoint.split(':')[0],
      port: parseInt(config.endpoint.split(':')[1]) || 9000,
      useSSL: false,
      accessKey: config.accessKey,
      secretKey: config.secretKey
    });
    this.bucketName = config.bucket;
  }

  async initialize(): Promise<void> {
    try {
      const exists = await this.client.bucketExists(this.bucketName);
      if (!exists) {
        await this.client.makeBucket(this.bucketName);
        logger.info(`Created bucket: ${this.bucketName}`);
      }
    } catch (error) {
      logger.error('Failed to initialize storage', { error: error instanceof Error ? error.message : error });
      throw error;
    }
  }

  async uploadDOMSnapshot(scanId: string, domContent: string): Promise<string> {
    const objectName = `scans/${scanId}/dom-snapshot.html`;
    const buffer = Buffer.from(domContent, 'utf-8');
    
    try {
      await this.client.putObject(this.bucketName, objectName, buffer, buffer.length, {
        'Content-Type': 'text/html',
        'X-Scan-ID': scanId
      });
      
      logger.info('DOM snapshot uploaded', { scanId, objectName });
      return objectName;
    } catch (error) {
      logger.error('Failed to upload DOM snapshot', { scanId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  }

  async uploadScript(scanId: string, scriptContent: string, filename?: string): Promise<string> {
    const scriptId = uuidv4();
    const objectName = `scans/${scanId}/scripts/${filename || `script-${scriptId}.js`}`;
    const buffer = Buffer.from(scriptContent, 'utf-8');
    
    try {
      await this.client.putObject(this.bucketName, objectName, buffer, buffer.length, {
        'Content-Type': 'application/javascript',
        'X-Scan-ID': scanId,
        'X-Script-ID': scriptId
      });
      
      logger.debug('Script uploaded', { scanId, scriptId, objectName });
      return objectName;
    } catch (error) {
      logger.error('Failed to upload script', { scanId, scriptId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  }

  async uploadSourceMap(scanId: string, sourceMapContent: string, filename?: string): Promise<string> {
    const mapId = uuidv4();
    const objectName = `scans/${scanId}/sourcemaps/${filename || `sourcemap-${mapId}.map`}`;
    const buffer = Buffer.from(sourceMapContent, 'utf-8');
    
    try {
      await this.client.putObject(this.bucketName, objectName, buffer, buffer.length, {
        'Content-Type': 'application/json',
        'X-Scan-ID': scanId,
        'X-SourceMap-ID': mapId
      });
      
      logger.debug('Source map uploaded', { scanId, mapId, objectName });
      return objectName;
    } catch (error) {
      logger.error('Failed to upload source map', { scanId, mapId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  }

  async uploadScreenshot(scanId: string, screenshot: Buffer): Promise<string> {
    const objectName = `scans/${scanId}/screenshot.png`;
    
    try {
      await this.client.putObject(this.bucketName, objectName, screenshot, screenshot.length, {
        'Content-Type': 'image/png',
        'X-Scan-ID': scanId
      });
      
      logger.info('Screenshot uploaded', { scanId, objectName });
      return objectName;
    } catch (error) {
      logger.error('Failed to upload screenshot', { scanId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  }

  async uploadNetworkTrace(scanId: string, networkData: any): Promise<string> {
    const objectName = `scans/${scanId}/network-trace.json`;
    const buffer = Buffer.from(JSON.stringify(networkData, null, 2), 'utf-8');
    
    try {
      await this.client.putObject(this.bucketName, objectName, buffer, buffer.length, {
        'Content-Type': 'application/json',
        'X-Scan-ID': scanId
      });
      
      logger.info('Network trace uploaded', { scanId, objectName });
      return objectName;
    } catch (error) {
      logger.error('Failed to upload network trace', { scanId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  }

  async getObject(objectName: string): Promise<Buffer> {
    try {
      const stream = await this.client.getObject(this.bucketName, objectName);
      const chunks: Buffer[] = [];
      
      return new Promise((resolve, reject) => {
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
      });
    } catch (error) {
      logger.error('Failed to get object', { objectName, error: error instanceof Error ? error.message : error });
      throw error;
    }
  }

  async deleteObject(objectName: string): Promise<void> {
    try {
      await this.client.removeObject(this.bucketName, objectName);
      logger.debug('Object deleted', { objectName });
    } catch (error) {
      logger.error('Failed to delete object', { objectName, error: error instanceof Error ? error.message : error });
      throw error;
    }
  }

  async deleteScanArtifacts(scanId: string): Promise<void> {
    try {
      const objectsList = this.client.listObjects(this.bucketName, `scans/${scanId}/`, true);
      const objectsToDelete: string[] = [];

      objectsList.on('data', (obj) => {
        if (obj.name) {
          objectsToDelete.push(obj.name);
        }
      });

      objectsList.on('end', async () => {
        if (objectsToDelete.length > 0) {
          await this.client.removeObjects(this.bucketName, objectsToDelete);
          logger.info('Scan artifacts deleted', { scanId, count: objectsToDelete.length });
        }
      });

      objectsList.on('error', (error) => {
        logger.error('Failed to list scan artifacts for deletion', { scanId, error: error.message });
        throw error;
      });
    } catch (error) {
      logger.error('Failed to delete scan artifacts', { scanId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  }
}
