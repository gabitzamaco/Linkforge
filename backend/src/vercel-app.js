import { createApp } from './app.js';

export function createVercelApp({ env = process.env, store } = {}) {
  const deploymentHost =
    env.VERCEL_ENV === 'production'
      ? env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL
      : env.VERCEL_URL;

  return createApp({
    store,
    baseUrl: env.BASE_URL || (deploymentHost ? `https://${deploymentHost}` : null),
    // Vercel forwards the named :path* rewrite capture in the query string.
    routingQueryKeys: ['path'],
  });
}
