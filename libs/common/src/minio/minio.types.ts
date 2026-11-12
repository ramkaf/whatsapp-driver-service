import type { MinioConfig } from '../config/minio/minio.env.ts';

export type MinioOptions = MinioConfig;
export const MINIO_OPTIONS = Symbol('MINIO_OPTIONS');
