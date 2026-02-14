import { registerAs } from '@nestjs/config';

export const StorageConfig = registerAs('STORAGE', () => ({
  provider: process.env.STORAGE_PROVIDER || 'leveldb',
  postgres: {
    host: process.env.PG_HOST || 'localhost',
    port: Number(process.env.PG_PORT) || 5432,
    user: process.env.PG_USER || 'courthive',
    password: process.env.PG_PASSWORD || '',
    database: process.env.PG_DATABASE || 'courthive',
  },
}));
