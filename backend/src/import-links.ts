import { createStore } from './store.ts';
import type { StoredLink } from '../../shared/types.ts';
import type { Database } from './types.ts';

export interface LegacyLinkRow {
  code: string;
  url: string;
  created_at: string;
  clicks: number;
  last_clicked_at: string | null;
}

export function parseLegacyLinks(rows: Record<string, unknown>[]): LegacyLinkRow[] {
  return rows.map((row) => {
    const { code, url, created_at, clicks, last_clicked_at } = row;
    if (
      typeof code !== 'string' ||
      typeof url !== 'string' ||
      typeof created_at !== 'string' ||
      typeof clicks !== 'number' ||
      (last_clicked_at !== null && typeof last_clicked_at !== 'string')
    ) {
      throw new Error('The SQLite source contains invalid link column types.');
    }
    return { code, url, created_at, clicks, last_clicked_at };
  });
}

function sameLink(source: LegacyLinkRow, target: StoredLink) {
  return (
    source.code === target.code &&
    source.url === target.url &&
    new Date(source.created_at).toISOString() === target.createdAt &&
    source.clicks === target.clicks &&
    (source.last_clicked_at ? new Date(source.last_clicked_at).toISOString() : null) ===
      target.lastClickedAt
  );
}

export async function importLinks(database: Database, rows: LegacyLinkRow[]) {
  if (!rows.length) return { imported: 0, verified: 0 };
  const store = createStore(database);
  const existing = new Map((await store.list()).map((link) => [link.code, link]));
  for (const row of rows) {
    const target = existing.get(row.code);
    if (target && !sameLink(row, target)) {
      throw new Error(
        `Import stopped: existing code ${row.code} has different data. Nothing overwritten.`,
      );
    }
  }
  const inserted = await database.query(
    `INSERT INTO links (code, url, created_at, clicks, last_clicked_at)
     SELECT code, url, created_at, clicks, last_clicked_at
     FROM jsonb_to_recordset($1::jsonb) AS imported(
       code TEXT, url TEXT, created_at TIMESTAMPTZ, clicks INTEGER,
       last_clicked_at TIMESTAMPTZ, position INTEGER
     )
     ORDER BY position
     ON CONFLICT (code) DO NOTHING RETURNING code`,
    [JSON.stringify(rows.map((row, position) => ({ ...row, position })))],
  );
  const saved = new Map((await store.list()).map((link) => [link.code, link]));
  for (const row of rows) {
    const target = saved.get(row.code);
    if (!target || !sameLink(row, target)) {
      throw new Error(
        'Import verification failed. Keep the SQLite source and check concurrent writers.',
      );
    }
  }
  return { imported: inserted.length, verified: rows.length };
}
