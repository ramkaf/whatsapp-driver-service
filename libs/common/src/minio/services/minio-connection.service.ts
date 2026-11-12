import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import * as Minio from 'minio';
import { setTimeout as delay } from 'node:timers/promises';
import { MINIO_OPTIONS, type MinioOptions } from '../minio.types.ts';

@Injectable()
export class MinioConnectionService implements OnModuleInit {
  private readonly logger = new Logger(MinioConnectionService.name);
  readonly client: Minio.Client;

  readonly bucket: string;
  private readonly healthUrl: string;

  constructor(@Inject(MINIO_OPTIONS) options: MinioOptions) {
    const { endpoint, port, useSsl, accessKey, secretKey, bucket } = options;

    this.bucket = bucket;
    const host =
      endpoint.includes(':') && !endpoint.startsWith('[')
        ? `[${endpoint}]`
        : endpoint;
    this.healthUrl = `${useSsl ? 'https' : 'http'}://${host}:${port}/minio/health/ready`;

    this.client = new Minio.Client({
      endPoint: endpoint,
      port,
      useSSL: useSsl,
      accessKey,
      secretKey,
      retryOptions: { disableRetry: true },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.waitForConnection();

    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      try {
        await this.client.makeBucket(this.bucket, 'us-east-1');
      } catch (error) {
        // Another instance may have created the bucket concurrently.
        if (!this.isBucketAlreadyOwned(error)) throw error;
      }
    }
    this.logger.log(`MinIO ready: ${this.bucket}`);
  }

  private async waitForConnection(): Promise<void> {
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(this.healthUrl, {
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) {
          throw new Error(`MinIO health check failed: HTTP ${response.status}`);
        }
        this.logger.log('MINIO_CONNECTED');
        return;
      } catch (error) {
        if (attempt === maxAttempts) {
          this.logger.error(
            `MINIO_CONNECTION_FAILED after ${maxAttempts} attempts`,
          );
          throw error;
        }
        const retryDelay = Math.min(1000 * 2 ** (attempt - 1), 10000);
        this.logger.warn(
          `MINIO_CONNECTION_RETRY attempt=${attempt} delayMs=${retryDelay}`,
        );
        await delay(retryDelay);
      }
    }
  }

  private isBucketAlreadyOwned(error: unknown): boolean {
    return (
      !!error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'BucketAlreadyOwnedByYou'
    );
  }
}
