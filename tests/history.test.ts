import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import type { Database, Store } from '../backend/src/types.ts';
import type { ApiErrorResponse, HistoryResponse } from '../shared/types.ts';
import { localOrigin, readJson, required } from './helpers/http.ts';
import { createApp } from '../backend/src/app.ts';
import { createStore } from '../backend/src/store.ts';
import { migrate } from '../backend/src/migrate.ts';
import { testDatabase } from './helpers/database.ts';

// Override the SQL clock only in tests; production always uses PostgreSQL time.
function storeAt(database: Database, timestamp: string) {
  return createStore({
    ...database,
    query<Row extends object>(text: string, values: unknown[] = []) {
      if (!text.includes('statement_timestamp()')) return database.query<Row>(text, values);
      return database.query<Row>(
        text.replaceAll('statement_timestamp()', `$${values.length + 1}::timestamptz`),
        [...values, timestamp],
      );
    },
  });
}

async function seedLink(
  database: Database,
  { code = 'history', startedAt = '2026-11-02T12:00:00Z', clicks = 0 } = {},
) {
  await database.query(
    `INSERT INTO links (code, url, created_at, history_started_at, clicks)
     VALUES ($1, 'https://example.com/original', $2, $2, $3)`,
    [code, startedAt, clicks],
  );
}

async function startApi(t: TestContext, store: Store) {
  const server = createApp({ store, baseUrl: null }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const origin = localOrigin(server);
  return (path: string, options?: RequestInit) => fetch(`${origin}${path}`, options);
}

test('migration preserves legacy totals without inventing daily history and is repeatable', async () => {
  const database = await testDatabase();
  // Simulate the existing production schema in this isolated embedded database.
  await database.query('DROP TABLE link_click_daily');
  await database.query('ALTER TABLE links DROP COLUMN history_started_at');
  await database.query(
    "DELETE FROM linkforge_migrations WHERE version IN ('003-click-history.sql', '004-daily-clicks.sql')",
  );
  await database.query(
    `INSERT INTO links (code, url, created_at, clicks, last_clicked_at)
     VALUES ('legacy', 'https://example.com/', '2026-01-01', 42, '2026-02-01')`,
  );
  try {
    assert.deepEqual(await migrate(database), ['003-click-history.sql', '004-daily-clicks.sql']);
    const link = required(await createStore(database).get('legacy'));
    assert.equal(link.clicks, 42);
    assert.equal(link.lastClickedAt, '2026-02-01T00:00:00.000Z');
    const history = required(await createStore(database).history('legacy'));
    assert.equal(history.lifetimeClicks, 42);
    assert.equal(history.periodClicks, 0);
    assert.ok(Number.isFinite(Date.parse(history.trackingStartedAt)));
    assert.equal(required(history.buckets.at(-1)).clicks, 0);
    assert.ok(history.buckets.slice(0, -1).every((bucket) => bucket.clicks === null));
    assert.deepEqual(await database.query('SELECT * FROM link_click_daily'), []);
    assert.deepEqual(await migrate(database), []);
  } finally {
    await migrate(database);
  }
});

test('concurrent visits increment both counters and use database time for last click', async () => {
  const database = await testDatabase();
  await seedLink(database);
  const store = storeAt(database, '2026-11-05T10:30:00Z');
  await Promise.all(Array.from({ length: 20 }, () => store.visit('history')));
  const history = required(await store.history('history', 7));
  assert.equal(history.lifetimeClicks, 20);
  assert.equal(history.periodClicks, 20);
  assert.equal(required(history.buckets.at(-1)).clicks, 20);
  assert.equal(required(await store.get('history')).lastClickedAt, '2026-11-05T10:30:00.000Z');
  assert.equal(await store.visit('missing'), null);
  assert.equal((await database.query('SELECT * FROM link_click_daily')).length, 1);
});

test('UTC midnight splits buckets independently of session timezone and last click stays monotonic', async () => {
  const database = await testDatabase();
  await seedLink(database);
  await database.query("SET TIME ZONE 'Europe/Bucharest'");
  try {
    await storeAt(database, '2026-11-04T23:59:59.999Z').visit('history');
    await storeAt(database, '2026-11-05T00:00:00Z').visit('history');
    // A request timestamp captured before a lock wait must not move last click backwards.
    await storeAt(database, '2026-11-04T23:59:59.999Z').visit('history');
    const store = storeAt(database, '2026-11-05T00:00:01Z');
    const history = required(await store.history('history', 7));
    assert.deepEqual(history.buckets.slice(-2), [
      { date: '2026-11-04', clicks: 2, partial: false },
      { date: '2026-11-05', clicks: 1, partial: true },
    ]);
    assert.equal(required(await store.get('history')).lastClickedAt, '2026-11-05T00:00:00.000Z');
  } finally {
    await database.query('RESET TIME ZONE');
  }
});

test('history distinguishes untracked dates, zero days, partial days and older lifetime clicks', async () => {
  const database = await testDatabase();
  await seedLink(database, { clicks: 8 });
  await database.query("INSERT INTO link_click_daily VALUES ('history', '2026-11-02', 3)");
  const store = storeAt(database, '2026-11-05T12:00:00Z');
  const history = required(await store.history('history', 7));
  assert.equal(history.days, 7);
  assert.equal(history.timezone, 'UTC');
  assert.equal(history.asOf, '2026-11-05T12:00:00.000Z');
  assert.equal(history.trackingStartedAt, '2026-11-02T12:00:00.000Z');
  assert.equal(history.lifetimeClicks, 8);
  assert.equal(history.periodClicks, 3);
  assert.deepEqual(history.buckets, [
    { date: '2026-10-30', clicks: null, partial: false },
    { date: '2026-10-31', clicks: null, partial: false },
    { date: '2026-11-01', clicks: null, partial: false },
    { date: '2026-11-02', clicks: 3, partial: true },
    { date: '2026-11-03', clicks: 0, partial: false },
    { date: '2026-11-04', clicks: 0, partial: false },
    { date: '2026-11-05', clicks: 0, partial: true },
  ]);
  await database.query("UPDATE links SET history_started_at = '2026-10-01T00:00:00Z'");
  await database.query("INSERT INTO link_click_daily VALUES ('history', '2026-10-01', 5)");
  assert.equal(required(await store.history('history', 30)).periodClicks, 3);
  await database.query("UPDATE links SET history_started_at = '2026-11-02T00:00:00Z'");
  assert.equal(required(required(await store.history('history', 7)).buckets[3]).partial, false);
});

test('a failed daily write rolls back the lifetime increment and last-click update', async () => {
  const database = await testDatabase();
  await seedLink(database);
  const store = storeAt(database, '2026-11-05T12:00:00Z');
  const original = await store.get('history');
  await database.query(
    'ALTER TABLE link_click_daily ADD CONSTRAINT reject_visit CHECK (clicks = 0)',
  );
  try {
    await assert.rejects(store.visit('history'));
    assert.deepEqual(await store.get('history'), original);
    assert.deepEqual(await database.query('SELECT * FROM link_click_daily'), []);
  } finally {
    await database.query('ALTER TABLE link_click_daily DROP CONSTRAINT reject_visit');
  }
});

test('history API validates ranges, returns snapshots, and HEAD and reads do not count clicks', async (t) => {
  const database = await testDatabase();
  await seedLink(database);
  const request = await startApi(t, storeAt(database, '2026-11-05T12:00:00Z'));
  for (const range of ['', '?days=7', '?days=30']) {
    const response = await request(`/api/links/history/history${range}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const { history } = await readJson<HistoryResponse>(response);
    assert.equal(history.buckets.length, range === '?days=7' ? 7 : 30);
    assert.equal(history.lifetimeClicks, 0);
  }
  for (const range of [
    'days=',
    'days=14',
    'days=07',
    'days=7.0',
    'days=%2B7',
    'days=7&days=30',
    'days[]=7',
    'days[x]=7',
  ]) {
    const response = await request(`/api/links/history/history?${range}`);
    assert.equal(response.status, 400, range);
    assert.equal(typeof (await readJson<ApiErrorResponse>(response)).error, 'string');
  }
  assert.equal((await request('/api/links/missing/history')).status, 404);
  assert.equal((await request('/s/history', { method: 'HEAD', redirect: 'manual' })).status, 302);
  assert.equal((await request('/s/missing', { redirect: 'manual' })).status, 404);
  const response = await request('/s/history', { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://example.com/original');
  await response.text();
  const { history } = await readJson<HistoryResponse>(
    await request('/api/links/history/history?days=7'),
  );
  assert.equal(history.periodClicks, 1);
  assert.equal(history.lifetimeClicks, 1);
});

test('destination edits preserve history, deletion cascades and alias reuse starts clean', async () => {
  const database = await testDatabase();
  await seedLink(database);
  const store = storeAt(database, '2026-11-05T12:00:00Z');
  await store.visit('history');
  const history = required(await store.history('history'));
  await store.update('history', 'https://example.com/new');
  assert.deepEqual(await store.history('history'), history);
  await store.delete('history');
  assert.equal(await store.history('history'), null);
  assert.deepEqual(await database.query('SELECT * FROM link_click_daily'), []);
  await store.create({ code: 'history', url: 'https://example.com/reused' });
  assert.equal(required(await store.history('history')).lifetimeClicks, 0);
  assert.equal(required(await store.history('history')).periodClicks, 0);
});

test('history and tracking start survive database reopening', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'linkforge-history-'));
  const path = join(directory, 'postgres');
  let database: Database | undefined;
  try {
    database = await testDatabase(path);
    await seedLink(database);
    const store = storeAt(database, '2026-11-05T12:00:00Z');
    await store.visit('history');
    const history = required(await store.history('history'));
    await database.close();
    database = await testDatabase(path);
    assert.deepEqual(await storeAt(database, '2026-11-05T12:00:00Z').history('history'), history);
  } finally {
    await database?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('history database failures return sanitized JSON errors', async (t) => {
  const request = await startApi(t, {
    ...createStore(await testDatabase()),
    history: async () => {
      throw new Error('private database secret');
    },
  });
  const response = await request('/api/links/history/history');
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: 'An unexpected error occurred. Please try again.',
  });
});

test('health reports unavailable when either history schema addition is missing', async (t) => {
  const database = await testDatabase();
  const request = await startApi(t, createStore(database));
  await database.query('ALTER TABLE link_click_daily RENAME TO unavailable_daily');
  try {
    assert.equal((await request('/api/health')).status, 503);
  } finally {
    await database.query('ALTER TABLE unavailable_daily RENAME TO link_click_daily');
  }
  await database.query('ALTER TABLE links RENAME COLUMN history_started_at TO unavailable_start');
  try {
    assert.equal((await request('/api/health')).status, 503);
  } finally {
    await database.query('ALTER TABLE links RENAME COLUMN unavailable_start TO history_started_at');
  }
  assert.equal((await request('/api/health')).status, 200);
});
