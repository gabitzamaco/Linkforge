import assert from 'node:assert/strict';
import test from 'node:test';
import { localOrigin, required } from './helpers/http.ts';
import { createDatabase } from '../backend/src/database.ts';
import { createStore } from '../backend/src/store.ts';
import { createApp } from '../backend/src/app.ts';
import { importLinks, parseLegacyLinks } from '../backend/src/import-links.ts';
import { migrate } from '../backend/src/migrate.ts';
import { testDatabase } from './helpers/database.ts';

const legacyRow = {
  code: 'legacy-link',
  url: 'https://example.com/legacy',
  created_at: '2026-01-02T03:04:05.000Z',
  clicks: 7,
  last_clicked_at: '2026-02-03T04:05:06.000Z',
};

test('SQLite source decoding preserves valid columns and rejects invalid column types', () => {
  const nullable = { ...legacyRow, last_clicked_at: null };
  assert.deepEqual(parseLegacyLinks([legacyRow, nullable]), [legacyRow, nullable]);
  for (const invalid of [
    { ...legacyRow, code: 12 },
    { ...legacyRow, url: null },
    { ...legacyRow, created_at: 12 },
    { ...legacyRow, clicks: '7' },
    { ...legacyRow, last_clicked_at: undefined },
  ]) {
    assert.throws(() => parseLegacyLinks([invalid]), /invalid link column types/);
  }
});

test('database configuration requires a PostgreSQL URL without exposing credentials', () => {
  assert.throws(() => createDatabase(''), /DATABASE_URL is required/);
  for (const url of [
    'not-a-url',
    'https://user:secret@example.com/db',
    'postgresql://user:secret@example.com/',
  ]) {
    assert.throws(
      () => createDatabase(url),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /valid PostgreSQL/);
        assert.doesNotMatch(error.message, /secret/);
        return true;
      },
    );
  }
});

test('schema migrations can be repeated without losing existing links', async () => {
  const database = await testDatabase();
  const store = createStore(database);
  await store.create({ code: 'kept', url: 'https://example.com/' });
  assert.deepEqual(await migrate(database), []);
  assert.equal((await store.list()).length, 1);
});

test('SQLite import preserves codes, destinations, timestamps, counts, and ordering on rerun', async () => {
  const database = await testDatabase();
  const second = { ...legacyRow, code: 'second-link', clicks: 0, last_clicked_at: null };
  assert.deepEqual(await importLinks(database, [legacyRow, second]), { imported: 2, verified: 2 });
  assert.deepEqual(await importLinks(database, [legacyRow, second]), { imported: 0, verified: 2 });
  const links = await createStore(database).list();
  assert.deepEqual(
    links.map((link) => link.code),
    ['second-link', 'legacy-link'],
  );
  assert.deepEqual(links[1], {
    id: legacyRow.code,
    code: legacyRow.code,
    url: legacyRow.url,
    createdAt: legacyRow.created_at,
    clicks: legacyRow.clicks,
    lastClickedAt: legacyRow.last_clicked_at,
  });
});

test('import rejects differing existing codes before inserting any source rows', async () => {
  const database = await testDatabase();
  const store = createStore(database);
  await store.create({ code: legacyRow.code, url: 'https://example.com/keep' });
  await assert.rejects(
    importLinks(database, [{ ...legacyRow, code: 'new-link' }, legacyRow]),
    /existing code.*different data/,
  );
  const links = await store.list();
  assert.equal(links.length, 1);
  assert.equal(required(links[0]).url, 'https://example.com/keep');
});

test('concurrent visits increment the saved click count without lost updates', async () => {
  const database = await testDatabase();
  const store = createStore(database);
  await store.create({ code: 'concurrent', url: 'https://example.com/' });
  await Promise.all(Array.from({ length: 20 }, () => store.visit('concurrent')));
  assert.equal(required(await store.get('concurrent')).clicks, 20);
});

test('health and async routes handle database failures without leaking details', async (t) => {
  const failure = async () => {
    throw new Error('private database credential');
  };
  const app = createApp({
    store: { ...createStore(await testDatabase()), check: failure, list: failure },
    baseUrl: null,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const origin = localOrigin(server);
  for (const [path, status] of [
    ['/api/health', 503],
    ['/api/links', 500],
  ]) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /private database credential/);
  }
});
