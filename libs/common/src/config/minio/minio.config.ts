import { registerAs } from '@nestjs/config';
import { readMinioConfig } from './minio.env.ts';

export const minioConfig = registerAs('minio', () => readMinioConfig());
