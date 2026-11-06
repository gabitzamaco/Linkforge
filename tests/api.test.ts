import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { TestContext } from 'node:test';
import type { AppOptions } from '../backend/src/app.ts';
import type { ApiErrorResponse, CreateLinkResponse, LinksResponse } from '../shared/types.ts';
import { localOrigin, readJson, required } from './helpers/http.ts';
import { createApp } from '../backend/src/app.ts';
import { createStore } from '../backend/src/store.ts';
import { testDatabase } from './helpers/database.ts';

async function startApp(t: TestContext, options: AppOptions & { dataDir?: string } = {}) {
  const { dataDir, ...appOptions } = options;
  const database = await testDatabase(dataDir);
  const app = createApp({ store: createStore(database), baseUrl: null, ...appOptions });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = localOrigin(server);
  let closed = false;

  async function close() {
    if (closed) return;
    closed = true;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await app.locals.store.close();
  }

  t.after(close);

  return {
    origin,
    close,
    request: (path: string, options?: RequestInit) => fetch(`${origin}${path}`, options),
    create: (body: unknown) =>
      fetch(`${origin}/api/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
  };
}

async function assertError(response: Response, status: number) {
  assert.equal(response.status, status);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  const body = await readJson<ApiErrorResponse>(response);
  assert.equal(typeof body.error, 'string');
  assert.ok(body.error.length > 0);
}

test('health endpoint responds and a new database has no links', async (t) => {
  const api = await startApp(t);
  const health = await api.request('/api/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });

  const list = await api.request('/api/links');
  assert.equal(list.status, 200);
  assert.deepEqual(await list.json(), { links: [] });
});

test('creates a generated short link with destination and initial statistics', async (t) => {
  const api = await startApp(t);
  const url = 'https://example.com/articles/hello?source=linkforge#details';
  const response = await api.create({ url });
  assert.equal(response.status, 201);

  const { link } = await readJson<CreateLinkResponse>(response);
  assert.ok(link.id);
  assert.match(link.code, /^[A-Za-z0-9_-]{3,32}$/);
  assert.equal(link.url, url);
  assert.equal(link.shortUrl, `${api.origin}/s/${link.code}`);
  assert.equal(link.clicks, 0);
  assert.equal(link.lastClickedAt, null);
  assert.ok(Number.isFinite(Date.parse(link.createdAt)));

  const { links } = await readJson<LinksResponse>(await api.request('/api/links'));
  assert.deepEqual(links, [link]);
});

test('uses the configured public origin when building short URLs', async (t) => {
  const api = await startApp(t, { baseUrl: 'https://links.example.com' });
  const response = await api.create({
    url: 'http://example.com/path',
    customCode: 'release_2026',
  });
  assert.equal(response.status, 201);
  const { link } = await readJson<CreateLinkResponse>(response);
  assert.equal(link.code, 'release_2026');
  assert.equal(link.shortUrl, 'https://links.example.com/s/release_2026');
});

test('accepts valid custom codes at both length boundaries', async (t) => {
  const api = await startApp(t);
  for (const customCode of ['a-B', 'a'.repeat(32)]) {
    const response = await api.create({ url: 'https://example.com/', customCode });
    assert.equal(response.status, 201);
    assert.equal((await readJson<CreateLinkResponse>(response)).link.code, customCode);
  }
});

test('rejects missing, unsupported, credential-bearing, and non-string destinations', async (t) => {
  const api = await startApp(t);
  const bodies = [
    {},
    { url: '' },
    { url: '/relative/path' },
    { url: 'example.com' },
    { url: 'https:example.com' },
    { url: 'ftp://example.com/file' },
    { url: 'javascript:alert(1)' },
    { url: 'data:text/html,hello' },
    { url: 'https://user:password@example.com/' },
    { url: 'https://user@example.com/' },
    { url: 'https://example.com/\r\nInjected: yes' },
    { url: 'https://exa\nmple.com/' },
    { url: 42 },
    { url: null },
    { url: ['https://example.com/'] },
    { url: `https://example.com/${'x'.repeat(9000)}` },
  ];

  for (const body of bodies) {
    await assertError(await api.create(body), 400);
  }
  assert.deepEqual(await readJson<LinksResponse>(await api.request('/api/links')), { links: [] });
});

test('rejects custom codes with invalid lengths, characters, or types', async (t) => {
  const api = await startApp(t);
  for (const customCode of [
    'ab',
    'a'.repeat(33),
    'has space',
    '../escape',
    'a/b',
    'café',
    42,
    null,
  ]) {
    await assertError(await api.create({ url: 'https://example.com/', customCode }), 400);
  }
});

test('duplicate custom codes return conflict without replacing the original destination', async (t) => {
  const api = await startApp(t);
  const original = await api.create({
    url: 'https://example.com/original',
    customCode: 'same-code',
  });
  assert.equal(original.status, 201);
  await original.json();

  await assertError(
    await api.create({ url: 'https://example.com/replacement', customCode: 'same-code' }),
    409,
  );
  const { links } = await readJson<LinksResponse>(await api.request('/api/links'));
  assert.equal(links.length, 1);
  assert.equal(required(links[0]).url, 'https://example.com/original');
});

test('concurrent requests for one alias create exactly one link', async (t) => {
  const api = await startApp(t);
  const results = await Promise.all([
    api.create({ url: 'https://example.com/one', customCode: 'one-alias' }),
    api.create({ url: 'https://example.com/two', customCode: 'one-alias' }),
  ]);
  assert.deepEqual(results.map((response) => response.status).sort(), [201, 409]);
  await Promise.all(results.map((response) => response.json()));
  const { links } = await readJson<LinksResponse>(await api.request('/api/links'));
  assert.equal(links.length, 1);
});

test('redirects to the saved destination and records every visit', async (t) => {
  const api = await startApp(t);
  const url = 'https://example.com/landing?campaign=summer#offer';
  const created = await api.create({ url, customCode: 'summer' });
  assert.equal(created.status, 201);
  await created.json();

  for (let count = 1; count <= 2; count += 1) {
    const response = await api.request('/s/summer', { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), url);
    await response.text();

    const { links } = await readJson<LinksResponse>(await api.request('/api/links'));
    assert.equal(required(links[0]).clicks, count);
    assert.ok(Number.isFinite(Date.parse(required(required(links[0]).lastClickedAt))));
  }
});

test('HEAD requests inspect redirects without incrementing click counts', async (t) => {
  const api = await startApp(t);
  const created = await api.create({ url: 'https://example.com/check', customCode: 'inspect' });
  assert.equal(created.status, 201);
  await created.json();

  const response = await api.request('/s/inspect', { method: 'HEAD', redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://example.com/check');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), '');
  const { links } = await readJson<LinksResponse>(await api.request('/api/links'));
  assert.equal(required(links[0]).clicks, 0);
  assert.equal(required(links[0]).lastClickedAt, null);
});

test('encoded control characters remain encoded and cannot inject response headers', async (t) => {
  const api = await startApp(t);
  const url = 'https://example.com/%0d%0aX-Injected:%20yes';
  const created = await api.create({ url, customCode: 'encoded' });
  assert.equal(created.status, 201);
  await created.json();

  const response = await api.request('/s/encoded', { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), url);
  assert.equal(response.headers.get('x-injected'), null);
  await response.text();
});

test('list returns multiple links in newest-first order', async (t) => {
  const api = await startApp(t);
  for (const customCode of ['first', 'second', 'third']) {
    const created = await api.create({ url: 'https://example.com/', customCode });
    assert.equal(created.status, 201);
    await created.json();
  }
  const { links } = await readJson<LinksResponse>(await api.request('/api/links'));
  assert.deepEqual(
    links.map((link) => link.code),
    ['third', 'second', 'first'],
  );
});

test('updating a destination preserves the short URL and statistics and changes the redirect', async (t) => {
  const api = await startApp(t, { baseUrl: 'https://links.example.com' });
  const created = await api.create({ url: 'https://example.com/original', customCode: 'editable' });
  assert.equal(created.status, 201);
  await created.json();
  const visit = await api.request('/s/editable', { redirect: 'manual' });
  assert.equal(visit.status, 302);
  await visit.text();
  const {
    links: [original],
  } = await readJson<LinksResponse>(await api.request('/api/links'));

  assert.ok(original);
  const url = 'https://example.com/updated?source=linkforge#details';
  const response = await api.request('/api/links/editable', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `  ${url}  ` }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await response.json(), { data: { ...original, url } });
  assert.deepEqual(await readJson<LinksResponse>(await api.request('/api/links')), {
    links: [{ ...original, url }],
  });

  const redirect = await api.request('/s/editable', { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), url);
  await redirect.text();
  const { links } = await readJson<LinksResponse>(await api.request('/api/links'));
  assert.equal(required(links[0]).clicks, 2);
});

test('updating an unknown code returns 404 without creating or changing links', async (t) => {
  const api = await startApp(t);
  const created = await api.create({ url: 'https://example.com/kept', customCode: 'keep-me' });
  assert.equal(created.status, 201);
  const { link } = await readJson<CreateLinkResponse>(created);

  const response = await api.request('/api/links/missing', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/replacement' }),
  });
  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  assert.deepEqual(await response.json(), { error: 'This short link does not exist.' });
  assert.deepEqual(await readJson<LinksResponse>(await api.request('/api/links')), {
    links: [link],
  });
});

test('invalid updates return 400 and preserve the existing destination', async (t) => {
  const api = await startApp(t);
  const created = await api.create({
    url: 'https://example.com/original',
    customCode: 'unchanged',
  });
  assert.equal(created.status, 201);
  const { link } = await readJson<CreateLinkResponse>(created);

  for (const body of [
    {},
    null,
    [],
    { url: '' },
    { url: '/relative' },
    { url: 'https:example.com' },
    { url: 'javascript:alert(1)' },
    { url: 'https://user:password@example.com/' },
    { url: 'https://example.com/\r\nInjected: yes' },
    { url: 42 },
    { url: null },
    { url: ['https://example.com/'] },
    { url: `https://example.com/${'x'.repeat(9000)}` },
  ]) {
    await assertError(
      await api.request('/api/links/unchanged', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      400,
    );
  }
  assert.deepEqual(await readJson<LinksResponse>(await api.request('/api/links')), {
    links: [link],
  });
});

test('deleting a link removes it from the dashboard and disables the redirect', async (t) => {
  const api = await startApp(t);
  const created = await api.create({ url: 'https://example.com/', customCode: 'remove-me' });
  assert.equal(created.status, 201);
  await created.json();

  const removed = await api.request('/api/links/remove-me', { method: 'DELETE' });
  assert.equal(removed.status, 204);
  assert.equal(await removed.text(), '');
  assert.deepEqual(await readJson<LinksResponse>(await api.request('/api/links')), { links: [] });
  assert.equal((await api.request('/s/remove-me', { redirect: 'manual' })).status, 404);
  await assertError(await api.request('/api/links/remove-me', { method: 'DELETE' }), 404);
});

test('unknown short links and API routes return 404', async (t) => {
  const api = await startApp(t);
  const missing = await api.request('/s/does-not-exist', { redirect: 'manual' });
  assert.equal(missing.status, 404);
  await missing.text();
  await assertError(await api.request('/api/does-not-exist'), 404);
});

test('malformed JSON returns a JSON error and leaves the server available', async (t) => {
  const api = await startApp(t);
  await assertError(
    await api.request('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"url":',
    }),
    400,
  );
  assert.equal((await api.request('/api/health')).status, 200);
});

test('oversized JSON requests return a bounded error response', async (t) => {
  const api = await startApp(t);
  await assertError(await api.create({ url: `https://example.com/${'x'.repeat(17000)}` }), 413);
  assert.equal((await api.request('/api/health')).status, 200);
});

test('links, destination updates, and click counts survive closing and reopening the database', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'linkforge-test-'));
  const dataDir = join(directory, 'postgres');
  const api = await startApp(t, { dataDir });
  const created = await api.create({
    url: 'https://example.com/persisted',
    customCode: 'persistent',
  });
  assert.equal(created.status, 201);
  const { link: original } = await readJson<CreateLinkResponse>(created);
  const visit = await api.request('/s/persistent', { redirect: 'manual' });
  assert.equal(visit.status, 302);
  await visit.text();
  const updatedUrl = 'https://example.com/persisted-update';
  const updated = await api.request('/api/links/persistent', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: updatedUrl }),
  });
  assert.equal(updated.status, 200);
  await updated.json();
  await api.close();

  const reopened = await startApp(t, { dataDir });
  try {
    const { links } = await readJson<LinksResponse>(await reopened.request('/api/links'));
    assert.equal(links.length, 1);
    assert.equal(required(links[0]).id, original.id);
    assert.equal(required(links[0]).url, updatedUrl);
    assert.equal(required(links[0]).createdAt, original.createdAt);
    assert.equal(required(links[0]).clicks, 1);
    assert.ok(Number.isFinite(Date.parse(required(required(links[0]).lastClickedAt))));
  } finally {
    await reopened.close();
    await rm(directory, { recursive: true, force: true });
  }
});
