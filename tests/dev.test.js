import assert from 'node:assert/strict';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';
import { createApp } from '../backend/src/app.js';
import frontendConfig from '../frontend/vite.config.js';

test('development serves React modules as JavaScript and proxies API calls and short links', async (t) => {
  const app = createApp({ dbPath: ':memory:', baseUrl: null });
  const backend = app.listen(0, '127.0.0.1');
  t.after(async () => {
    await new Promise((resolve) => backend.close(resolve));
    app.locals.store.close();
  });
  await once(backend, 'listening');
  const backendOrigin = `http://127.0.0.1:${backend.address().port}`;
  const frontend = await createServer({
    ...frontendConfig,
    configFile: false,
    root: fileURLToPath(new URL('../frontend/', import.meta.url)),
    logLevel: 'silent',
    server: {
      ...frontendConfig.server,
      port: 0,
      strictPort: false,
      ws: false,
      proxy: Object.fromEntries(
        Object.keys(frontendConfig.server.proxy).map((path) => [path, backendOrigin]),
      ),
    },
  });
  t.after(() => frontend.close());
  await frontend.listen();
  const origin = `http://127.0.0.1:${frontend.httpServer.address().port}`;

  for (const path of ['/src/main.jsx', '/src/App.jsx']) {
    const response = await fetch(`${origin}${path}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
    assert.doesNotMatch(await response.text(), /^<!doctype html>/i);
  }

  const health = await fetch(`${origin}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
  const target = 'https://example.com/proxy-check';
  const created = await fetch(`${origin}/api/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: target, customCode: 'proxy-check' }),
  });
  assert.equal(created.status, 201);
  await created.json();
  const redirect = await fetch(`${origin}/s/proxy-check`, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), target);
  await redirect.text();
});
