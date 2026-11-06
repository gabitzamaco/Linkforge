import { neon } from '@neondatabase/serverless';
import type { Database } from './types.ts';

export function createDatabase(databaseUrl = process.env.DATABASE_URL): Database {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required. Add your Neon connection string to .env.');
  }
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection string.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !parsed.hostname ||
    !parsed.username ||
    parsed.pathname.length <= 1
  ) {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection string.');
  }

  let sql;
  try {
    sql = neon(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection string.');
  }
  return {
    // Neon cannot infer result columns from SQL; keep that assertion at the adapter boundary.
    query: async <Row extends object>(text: string, values: unknown[] = []) =>
      (await sql.query(text, values)) as Row[],
    transaction: (queries) =>
      sql.transaction(queries.map(({ text, values = [] }) => sql.query(text, values))),
    // HTTP queries do not hold a persistent connection or require pool cleanup.
    close: async () => {},
  };
}
