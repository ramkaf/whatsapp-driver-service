import {
  IsEnum,
  IsBoolean,
  MinLength,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
} from 'class-validator';
import { EEnvironment } from './config.enum.ts';

export class EnvironmentVariablesValidator {
  @IsString()
  @MinLength(32)
  @IsOptional()
  WA_ADMIN_API_KEY?: string;

  @IsInt()
  @Min(1)
  @Max(50)
  @IsOptional()
  WA_MAX_SESSIONS?: number;

  @IsInt()
  @Min(1)
  @Max(5)
  @IsOptional()
  WA_STARTUP_CONCURRENCY?: number;

  @IsInt()
  @Min(100)
  @Max(60000)
  @IsOptional()
  WA_STARTUP_STAGGER_MS?: number;

  @IsInt()
  @Min(1000)
  @Max(2147483647)
  @IsOptional()
  WA_WATCHDOG_INTERVAL_MS?: number;

  @IsInt()
  @Min(1000)
  @Max(2147483647)
  @IsOptional()
  WA_CONNECTION_STUCK_MS?: number;

  @IsInt()
  @Min(1000)
  @Max(2147483647)
  @IsOptional()
  WA_STABLE_CONNECTION_MS?: number;

  @IsInt()
  @Min(1000)
  @Max(60000)
  @IsOptional()
  WA_PAIRING_TTL_MS?: number;

  @IsInt()
  @Min(1000)
  @Max(180000)
  @IsOptional()
  WA_PAIRING_CODE_TTL_MS?: number;

  @IsInt()
  @Min(1000)
  @Max(2147483647)
  @IsOptional()
  WA_PAIRING_RATE_LIMIT_MS?: number;

  @IsString()
  @IsOptional()
  REDIS_HOST?: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  REDIS_PORT?: number;

  @IsString()
  @IsOptional()
  REDIS_PASSWORD?: string;

  @IsInt()
  @Min(0)
  @Max(15)
  @IsOptional()
  REDIS_DB?: number;

  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  @IsOptional()
  REDIS_CONNECT_TIMEOUT_MS?: number;

  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  REDIS_CONNECTION_ATTEMPTS?: number;

  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  @IsOptional()
  REDIS_RETRY_DELAY_MS?: number;

  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  @IsOptional()
  REDIS_MAX_RETRY_DELAY_MS?: number;

  @IsString()
  @MinLength(1)
  @IsOptional()
  MINIO_ENDPOINT: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  MINIO_PORT: number;

  @IsBoolean()
  @IsOptional()
  MINIO_USE_SSL: boolean;

  @IsString()
  @MinLength(1)
  @IsOptional()
  MINIO_ACCESS_KEY: string;

  @IsString()
  @MinLength(1)
  @IsOptional()
  MINIO_SECRET_KEY: string;

  @IsString()
  @MinLength(1)
  @IsOptional()
  MINIO_BUCKET: string;

  @IsUrl({ protocols: ['mysql'], require_protocol: true, require_tld: false })
  @IsOptional()
  DATABASE_URL?: string;

  @IsEnum(EEnvironment)
  @IsOptional()
  NODE_ENV?: EEnvironment;

  @IsString()
  @IsOptional()
  APP_NAME?: string;

  @IsInt()
  @Min(0)
  @Max(65535)
  @IsOptional()
  APP_PORT?: number;

  @IsInt()
  @Min(0)
  @Max(65535)
  @IsOptional()
  PORT?: number;

  @IsUrl({
    require_tld: false,
    require_protocol: true,
    protocols: ['http', 'https'],
  })
  @IsOptional()
  FRONTEND_DOMAIN?: string;

  @IsUrl({
    require_tld: false,
    require_protocol: true,
    protocols: ['http', 'https'],
  })
  @IsOptional()
  BACKEND_DOMAIN?: string;

  @IsString()
  @IsOptional()
  APP_CORS_ORIGINS?: string;

  @IsString()
  @IsOptional()
  API_PREFIX?: string;
  // MySQL configuration
  @IsString()
  @IsOptional()
  MYSQL_HOST?: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  @IsOptional()
  MYSQL_PORT?: number;

  @IsString()
  @IsOptional()
  MYSQL_ROOT_PASSWORD?: string;

  @IsString()
  @IsOptional()
  MYSQL_DATABASE?: string;

  @IsString()
  @IsOptional()
  MYSQL_SHADOW_DATABASE?: string;

  @IsString()
  @IsOptional()
  MYSQL_USER?: string;

  @IsString()
  @IsOptional()
  MYSQL_PASSWORD?: string;
}
