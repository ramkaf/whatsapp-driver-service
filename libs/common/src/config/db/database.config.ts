import { registerAs } from '@nestjs/config';
import { readDatabaseConfig } from './database.env.ts';

export const databaseConfig = registerAs('database', () =>
  readDatabaseConfig(),
);