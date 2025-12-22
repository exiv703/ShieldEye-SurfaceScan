import { Client } from 'minio';
import { appConfig } from './config';
import { logger } from './logger';

export class MinioStorage {
  private client: Client;
  private bucketName: string;

  constructor(config = appConfig.minio) {
    const [host, portStr] = config.endpoint.split(':');
    this.client = new Client({
      endPoint: host,
      port: parseInt(portStr || '9000', 10),
      useSSL: false,
      accessKey: config.accessKey,
      secretKey: config.secretKey
    });
    this.bucketName = config.bucket;
  }

  async deleteScanArtifacts(scanId: string): Promise<void> {
    const prefix = `scans/${scanId}/`;

    try {
      const objectsStream = this.client.listObjects(this.bucketName, prefix, true);
      const objectsToDelete: string[] = [];

      await new Promise<void>((resolve, reject) => {
        objectsStream.on('data', (obj: any) => {
          if (obj.name) {
            objectsToDelete.push(obj.name);
          }
        });
        objectsStream.on('end', resolve);
        objectsStream.on('error', reject);
      });

      if (objectsToDelete.length > 0) {
        await this.client.removeObjects(this.bucketName, objectsToDelete);
        logger.info('Deleted scan artifacts from MinIO', { scanId, count: objectsToDelete.length });
      }
    } catch (error) {
      logger.error('Failed to delete scan artifacts from MinIO', { scanId, error: error instanceof Error ? error.message : error });
      throw error;
    }
  }
}

// Ensure bucket exists (idempotent)
export async function ensureMinioBucket(): Promise<void> {
  const [host, portStr] = appConfig.minio.endpoint.split(':');
  const client = new Client({
    endPoint: host,
    port: parseInt(portStr || '9000', 10),
    useSSL: false,
    accessKey: appConfig.minio.accessKey,
    secretKey: appConfig.minio.secretKey,
  });
  const bucket = appConfig.minio.bucket;
  try {
    const exists = await client.bucketExists(bucket);
    if (!exists) {
      await client.makeBucket(bucket, '');
      logger.info('Created MinIO bucket', { bucket });
    }
  } catch (error) {
    logger.warn('ensureMinioBucket encountered an error', {
      bucket,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
