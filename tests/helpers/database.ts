import { after } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../../backend/src/migrate.ts';
import type { Database } from '../../backend/src/types.ts';

let shared: Promise<Database> | undefined;

async function openDatabase(dataDir?: string): Promise<Database> {
  const client = await PGlite.create(dataDir);
  const database: Database = {
    query: async <Row extends object>(text: string, values: unknown[] = []) =>
      (await client.query<Row>(text, values)).rows,
    transaction: (queries) =>
      client.transaction(async (tx) => {
        const results: Record<string, unknown>[][] = [];
        for (const { text, values = [] } of queries) {
          results.push((await tx.query<Record<string, unknown>>(text, values)).rows);
        }
        return results;
      }),
    close: () => client.close(),
  };
  await migrate(database);
  return database;
}

export async function testDatabase(dataDir?: string): Promise<Database> {
  if (dataDir) return openDatabase(dataDir);
  shared ||= openDatabase();
  const database = await shared;
  await database.query('TRUNCATE link_click_daily, links RESTART IDENTITY');
  return { ...database, close: async () => {} };
}

after(async () => {
  if (shared) await (await shared).close();
});
