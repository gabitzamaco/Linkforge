import { readdir, readFile } from 'node:fs/promises';
import type { Database } from './types.ts';

export async function migrate(database: Database): Promise<string[]> {
  await database.query(`CREATE TABLE IF NOT EXISTS linkforge_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const applied = new Set(
    (await database.query<{ version: string }>('SELECT version FROM linkforge_migrations')).map(
      (row) => row.version,
    ),
  );
  const directory = new URL('../migrations/', import.meta.url);
  const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
  const completed = [];
  for (const version of files) {
    if (applied.has(version)) continue;
    const text = await readFile(new URL(version, directory), 'utf8');
    await database.transaction([
      { text: 'SELECT pg_advisory_xact_lock(746259134)' },
      { text },
      {
        text: 'INSERT INTO linkforge_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING',
        values: [version],
      },
    ]);
    completed.push(version);
  }
  return completed;
}
