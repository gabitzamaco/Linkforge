import { createDatabase } from './database.ts';
import type { HistoryDays, StoredLink } from '../../shared/types.ts';
import type { Database, Store } from './types.ts';

interface LinkRow {
  code: string;
  url: string;
  created_at: string | Date;
  clicks: number;
  last_clicked_at: string | Date | null;
}

interface HistoryRow {
  lifetime_clicks: number | string;
  history_started_at: string | Date;
  as_of: string | Date;
  date: string;
  daily_clicks: number | string | null;
  partial: boolean;
}

function toLink(row: LinkRow): StoredLink;
function toLink(row: LinkRow | undefined): StoredLink | null;
function toLink(row: LinkRow | undefined): StoredLink | null {
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

export function createStore(database: Database = createDatabase()): Store {
  return {
    async check() {
      await database.query(
        `SELECT links.history_started_at FROM links
         LEFT JOIN link_click_daily USING (code) LIMIT 1`,
      );
    },
    async list() {
      const rows = await database.query<LinkRow>(
        'SELECT * FROM links ORDER BY created_at DESC, sort_id DESC',
      );
      return rows.map((row) => toLink(row));
    },
    async get(code) {
      const rows = await database.query<LinkRow>('SELECT * FROM links WHERE code = $1', [code]);
      return toLink(rows[0]);
    },
    async create({ code, url }) {
      const rows = await database.query<LinkRow>(
        `INSERT INTO links (code, url, created_at) VALUES ($1, $2, $3)
         ON CONFLICT (code) DO NOTHING RETURNING *`,
        [code, url, new Date().toISOString()],
      );
      return toLink(rows[0]);
    },
    async update(code, url) {
      const rows = await database.query<LinkRow>(
        'UPDATE links SET url = $1 WHERE code = $2 RETURNING *',
        [url, code],
      );
      return toLink(rows[0]);
    },
    async delete(code) {
      const rows = await database.query('DELETE FROM links WHERE code = $1 RETURNING code', [code]);
      return rows.length > 0;
    },
    async visit(code) {
      // Both counters commit together. Lock the parent before writing its daily row,
      // so simultaneous redirects and deletion cannot leave lost or orphaned counts.
      const rows = await database.query<LinkRow>(
        `WITH recorded AS MATERIALIZED (SELECT statement_timestamp() AS at),
         updated AS (
           UPDATE links SET clicks = clicks + 1,
             last_clicked_at = GREATEST(last_clicked_at, recorded.at)
           FROM recorded WHERE code = $1 RETURNING links.*
         ), daily AS (
           INSERT INTO link_click_daily (code, day, clicks)
           SELECT updated.code, (recorded.at AT TIME ZONE 'UTC')::date, 1
           FROM updated CROSS JOIN recorded
           ON CONFLICT (code, day) DO UPDATE SET clicks = link_click_daily.clicks + 1
           RETURNING code
         )
         SELECT updated.* FROM updated JOIN daily USING (code)`,
        [code],
      );
      return toLink(rows[0]);
    },
    async history(code, days: HistoryDays = 30) {
      if (![7, 30].includes(days)) throw new RangeError('History supports 7 or 30 days.');
      // One statement provides a consistent snapshot of lifetime and daily counts.
      const rows = await database.query<HistoryRow>(
        `WITH clock AS (SELECT statement_timestamp() AS at),
         calendar AS (
           SELECT clock.at, (clock.at AT TIME ZONE 'UTC')::date - offset_days AS day
           FROM clock CROSS JOIN generate_series(0, $2::integer - 1) AS offset_days
         )
         SELECT links.clicks AS lifetime_clicks, links.history_started_at,
           calendar.at AS as_of, to_char(calendar.day, 'YYYY-MM-DD') AS date,
           CASE WHEN calendar.day < (links.history_started_at AT TIME ZONE 'UTC')::date
             THEN NULL ELSE COALESCE(daily.clicks, 0) END AS daily_clicks,
           (calendar.day = (calendar.at AT TIME ZONE 'UTC')::date OR
             (calendar.day = (links.history_started_at AT TIME ZONE 'UTC')::date AND
               (links.history_started_at AT TIME ZONE 'UTC')::time <> TIME '00:00:00'))
             AS partial
         FROM links CROSS JOIN calendar
         LEFT JOIN link_click_daily AS daily ON daily.code = links.code AND daily.day = calendar.day
         WHERE links.code = $1 ORDER BY calendar.day`,
        [code, days],
      );
      const first = rows[0];
      if (!first) return null;
      const buckets = rows.map((row) => ({
        date: row.date,
        clicks: row.daily_clicks === null ? null : Number(row.daily_clicks),
        partial: row.partial,
      }));
      return {
        code,
        timezone: 'UTC',
        days,
        asOf: new Date(first.as_of).toISOString(),
        trackingStartedAt: new Date(first.history_started_at).toISOString(),
        lifetimeClicks: Number(first.lifetime_clicks),
        periodClicks: buckets.reduce((total, bucket) => total + (bucket.clicks ?? 0), 0),
        buckets,
      };
    },
    close: () => database.close(),
  };
}
