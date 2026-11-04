import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createVercelApp } from '../backend/src/vercel-app.js';
import { createStore } from '../backend/src/store.js';
import { testDatabase } from './helpers/database.js';

const cases = [
  {
    name: 'production uses the stable HTTPS domain for short links',
    env: {
      VERCEL_ENV: 'production',
      VERCEL_PROJECT_PRODUCTION_URL: 'linkforge.example.com',
      VERCEL_URL: 'linkforge-deployment.vercel.app',
    },
    origin: 'https://linkforge.example.com',
  },
  {
    name: 'preview short links stay on the preview deployment',
    env: {
      VERCEL_ENV: 'preview',
      VERCEL_PROJECT_PRODUCTION_URL: 'linkforge.example.com',
      VERCEL_URL: 'linkforge-preview.vercel.app',
    },
    origin: 'https://linkforge-preview.vercel.app',
  },
  {
    name: 'an explicit public origin overrides the deployment hostname',
    env: {
      VERCEL_ENV: 'production',
      VERCEL_URL: 'deployment.vercel.app',
      BASE_URL: 'https://go.example.com',
    },
    origin: 'https://go.example.com',
  },
];

for (const { name, env, origin } of cases) {
  test(name, async (t) => {
    const store = createStore(await testDatabase());
    const app = createVercelApp({ env, store });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const localOrigin = `http://127.0.0.1:${server.address().port}`;
    const created = await fetch(`${localOrigin}/api/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/destination',
        customCode: 'deployment-test',
      }),
    });
    assert.equal(created.status, 201);
    const { link } = await created.json();
    assert.equal(link.shortUrl, `${origin}/s/deployment-test`);
    const list = await (await fetch(`${localOrigin}/api/links`)).json();
    assert.equal(list.links[0].shortUrl, link.shortUrl);
    const redirect = await fetch(`${localOrigin}/s/deployment-test`, { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), 'https://example.com/destination');
    await redirect.text();
  });
}
