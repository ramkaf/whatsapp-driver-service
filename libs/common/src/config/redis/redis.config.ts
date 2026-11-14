import { registerAs } from '@nestjs/config';
import { readRedisConfig } from './redis.env.ts';

export const redisConfig = registerAs('redis', () => readRedisConfig());
