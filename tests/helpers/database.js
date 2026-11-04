import { after } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from '../../backend/src/migrate.js';

let shared;

async function openDatabase(dataDir) {
  const client = await PGlite.create(dataDir);
  const database = {
    query: async (text, values = []) => (await client.query(text, values)).rows,
    transaction: (queries) =>
      client.transaction(async (tx) => {
        const results = [];
        for (const { text, values = [] } of queries) {
          results.push((await tx.query(text, values)).rows);
        }
        return results;
      }),
    close: () => client.close(),
  };
  await migrate(database);
  return database;
}

export async function testDatabase(dataDir) {
  if (dataDir) return openDatabase(dataDir);
  shared ||= openDatabase();
  const database = await shared;
  await database.query('TRUNCATE links RESTART IDENTITY');
  return { ...database, close: async () => {} };
}

after(async () => {
  if (shared) await (await shared).close();
});
