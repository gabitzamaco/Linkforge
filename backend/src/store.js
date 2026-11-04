import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function toLink(row) {
  if (!row) return null;

  return {
    id: row.code,
    code: row.code,
    url: row.url,
    createdAt: row.created_at,
    clicks: row.clicks,
    lastClickedAt: row.last_clicked_at,
  };
}

export function createStore(dbPath) {
  const filename = dbPath === ':memory:' ? dbPath : resolve(dbPath);
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });

  const database = new DatabaseSync(filename);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS links (
      code TEXT PRIMARY KEY NOT NULL,
      url TEXT NOT NULL,
      created_at TEXT NOT NULL,
      clicks INTEGER NOT NULL DEFAULT 0 CHECK (clicks >= 0),
      last_clicked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS links_created_at ON links (created_at DESC);
  `);

  const statements = {
    list: database.prepare('SELECT * FROM links ORDER BY created_at DESC, rowid DESC'),
    get: database.prepare('SELECT * FROM links WHERE code = ?'),
    create: database.prepare(`
      INSERT INTO links (code, url, created_at)
      VALUES (?, ?, ?) ON CONFLICT(code) DO NOTHING
    `),
    delete: database.prepare('DELETE FROM links WHERE code = ?'),
    visit: database.prepare(`
      UPDATE links SET clicks = clicks + 1, last_clicked_at = ?
      WHERE code = ? RETURNING *
    `),
  };

  return {
    list() {
      return statements.list.all().map(toLink);
    },
    get(code) {
      return toLink(statements.get.get(code));
    },
    create({ code, url }) {
      const result = statements.create.run(code, url, new Date().toISOString());
      return result.changes ? toLink(statements.get.get(code)) : null;
    },
    delete(code) {
      return statements.delete.run(code).changes > 0;
    },
    visit(code) {
      return toLink(statements.visit.get(new Date().toISOString(), code));
    },
    close() {
      database.close();
    },
  };
}
