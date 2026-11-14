import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';
import { getEnvironmentFile } from './libs/common/src/config/environment-file.ts';
import {
  createDatabaseUrl,
  readDatabaseConfig,
} from './libs/common/src/config/db/database.env.ts';

loadEnv({ path: getEnvironmentFile(), quiet: true });

const database = readDatabaseConfig();
const shadowDatabase = process.env.DB_SHADOW_NAME?.trim();
if (shadowDatabase === database.database) {
  throw new Error('DB_SHADOW_NAME must differ from DB_NAME');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: createDatabaseUrl(database),
    ...(shadowDatabase
      ? {
          shadowDatabaseUrl: createDatabaseUrl({
            ...database,
            database: shadowDatabase,
          }),
        }
      : {}),
  },
});
