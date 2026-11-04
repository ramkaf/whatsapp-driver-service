import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { defineConfig } from 'prisma/config';
import {
  getDatabaseUrl,
  getShadowDatabaseUrl,
} from './libs/common/src/config/database.config.ts';

if (existsSync('.env')) loadEnvFile('.env');

export default defineConfig({
  schema: 'libs/prisma/schema.prisma',
  migrations: { path: 'libs/prisma/migrations' },
  datasource: {
    url: getDatabaseUrl(process.env),
    shadowDatabaseUrl:getShadowDatabaseUrl(process.env)
  },
});
