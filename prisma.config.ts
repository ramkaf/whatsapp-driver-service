import 'dotenv/config';
import { defineConfig } from 'prisma/config';
import {
  createDatabaseUrl,
  readDatabaseConfig,
} from './libs/common/src/config/db/database.env.ts';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: createDatabaseUrl(readDatabaseConfig()),
  },
});
