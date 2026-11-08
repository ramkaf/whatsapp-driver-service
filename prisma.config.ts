import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { defineConfig } from 'prisma/config';
import {
  getDatabaseUrl,
  getShadowDatabaseUrl,
} from './libs/common/src/config/database.config.ts';

if (existsSync('.env')) loadEnvFile('.env');

export default defineConfig({
  schema: 'libs/common/src/prisma/schema.prisma',
  migrations: { path: 'libs/common/src/prisma/migrations' },
  datasource: {
    url: getDatabaseUrl(process.env),
    shadowDatabaseUrl: process.env.MYSQL_SHADOW_DATABASE
      ? getShadowDatabaseUrl(process.env)
      : undefined,
  },
});
