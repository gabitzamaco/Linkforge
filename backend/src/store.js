import { createDatabase } from './database.js';

function toLink(row) {
  if (!row) return null;

  return {
    id: row.code,
    code: row.code,
    url: row.url,
    createdAt: new Date(row.created_at).toISOString(),
    clicks: row.clicks,
    lastClickedAt: row.last_clicked_at ? new Date(row.last_clicked_at).toISOString() : null,
  };
}

export function createStore(database = createDatabase()) {
  return {
    async check() {
      await database.query('SELECT code FROM links LIMIT 1');
    },
    async list() {
      const rows = await database.query(
        'SELECT * FROM links ORDER BY created_at DESC, sort_id DESC',
      );
      return rows.map(toLink);
    },
    async get(code) {
      const rows = await database.query('SELECT * FROM links WHERE code = $1', [code]);
      return toLink(rows[0]);
    },
    async create({ code, url }) {
      const rows = await database.query(
        `INSERT INTO links (code, url, created_at) VALUES ($1, $2, $3)
         ON CONFLICT (code) DO NOTHING RETURNING *`,
        [code, url, new Date().toISOString()],
      );
      return toLink(rows[0]);
    },
    async update(code, url) {
      const rows = await database.query('UPDATE links SET url = $1 WHERE code = $2 RETURNING *', [
        url,
        code,
      ]);
      return toLink(rows[0]);
    },
    async delete(code) {
      const rows = await database.query('DELETE FROM links WHERE code = $1 RETURNING code', [code]);
      return rows.length > 0;
    },
    async visit(code) {
      // Increment in PostgreSQL to avoid lost counts from simultaneous redirects.
      const rows = await database.query(
        `UPDATE links SET clicks = clicks + 1, last_clicked_at = $1
         WHERE code = $2 RETURNING *`,
        [new Date().toISOString(), code],
      );
      return toLink(rows[0]);
    },
    close: () => database.close(),
  };
}
