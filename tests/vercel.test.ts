import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import type { CreateLinkResponse, HistoryResponse, LinksResponse } from '../shared/types.ts';
import { localOrigin, readJson, required } from './helpers/http.ts';
import { createVercelApp } from '../backend/src/vercel-app.ts';
import { createStore } from '../backend/src/store.ts';
import { testDatabase } from './helpers/database.ts';

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
    t.after(
      () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    );
    const originAddress = localOrigin(server);
    const created = await fetch(`${originAddress}/api/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/destination',
        customCode: 'deployment-test',
      }),
    });
    assert.equal(created.status, 201);
    const { link } = await readJson<CreateLinkResponse>(created);
    assert.equal(link.shortUrl, `${origin}/s/deployment-test`);
    const list = await readJson<LinksResponse>(await fetch(`${originAddress}/api/links`));
    assert.equal(required(list.links[0]).shortUrl, link.shortUrl);
    for (const days of [undefined, '7', '30']) {
      const query = new URLSearchParams({ path: 'links/deployment-test/history' });
      if (days) query.set('days', days);
      const response = await fetch(`${originAddress}/api/links/deployment-test/history?${query}`);
      assert.equal(response.status, 200);
      const { history } = await readJson<HistoryResponse>(response);
      assert.equal(history.buckets.length, Number(days || 30));
      assert.equal(history.periodClicks, 0);
    }
    for (const query of ['days=14', 'days=7&days=30', 'days[]=7', 'other=7']) {
      const response = await fetch(
        `${originAddress}/api/links/deployment-test/history?path=links/deployment-test/history&${query}`,
      );
      assert.equal(response.status, 400);
    }
    const redirect = await fetch(`${originAddress}/s/deployment-test`, { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), 'https://example.com/destination');
    await redirect.text();
  });
}
