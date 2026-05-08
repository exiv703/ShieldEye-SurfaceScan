import { Client } from 'minio';
import { appConfig } from './config';
import { logger } from './logger';
import fs from 'fs';

type MinioListedObject = {
  name?: string;
};

export class MinioStorage {
  private client: Client;
  private bucketName: string;

  private validateTlsCaCertificate(caCertPath: string): void {
    try {
      fs.readFileSync(caCertPath, 'utf8');
    } catch (error) {
      const errorMessage: string = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read TLS CA certificate from path '${caCertPath}': ${errorMessage}`);
    }
  }

  constructor(config = appConfig.minio) {
    // Fix: fail fast with clear error when a configured CA cert path is invalid.
    if (appConfig.tls.caCertPath) {
      this.validateTlsCaCertificate(appConfig.tls.caCertPath);
    }

    const [host, portStr] = config.endpoint.split(':');
    this.client = new Client({
      endPoint: host,
      port: parseInt(portStr || '9000', 10),
      useSSL: appConfig.tls.enabled,
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
        // Fix: avoid `any` and keep object-name extraction type-safe.
        objectsStream.on('data', (obj: MinioListedObject) => {
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
  // Fix: fail fast with clear error when a configured CA cert path is invalid.
  if (appConfig.tls.caCertPath) {
    try {
      fs.readFileSync(appConfig.tls.caCertPath, 'utf8');
    } catch (error) {
      const errorMessage: string = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read TLS CA certificate from path '${appConfig.tls.caCertPath}': ${errorMessage}`);
    }
  }

  const [host, portStr] = appConfig.minio.endpoint.split(':');
  const client = new Client({
    endPoint: host,
    port: parseInt(portStr || '9000', 10),
    useSSL: appConfig.tls.enabled,
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
