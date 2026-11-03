import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
} from 'class-validator';
import { EEnvironment } from './config.enum.ts';

export class EnvironmentVariablesValidator {
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
}
