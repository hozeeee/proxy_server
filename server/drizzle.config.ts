import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: './db-data/proxy.db',
  },
  verbose: true,
  strict: true,
} satisfies Config;
