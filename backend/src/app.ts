import express from 'express';
import type { ErrorRequestHandler, Express, Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.ts';
import type {
  ApiErrorResponse,
  CreateLinkResponse,
  HealthResponse,
  HistoryResponse,
  Link,
  LinksResponse,
  StoredLink,
  UpdateLinkResponse,
} from '../../shared/types.ts';
import type { Store } from './types.ts';

export interface AppOptions {
  store?: Store;
  baseUrl?: string | null;
  routingQueryKeys?: string[];
}

interface AppLocals {
  store: Store;
}

type CodeParams = { code: string };
type JsonResponse<T> = Response<T | ApiErrorResponse>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const frontendDirectory = fileURLToPath(new URL('../../frontend/dist/', import.meta.url));
const frontendIndex = fileURLToPath(new URL('../../frontend/dist/index.html', import.meta.url));
const codePattern = /^[A-Za-z0-9_-]{3,32}$/;
const maximumUrlLength = 8192;

function parseDestination(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > maximumUrlLength) {
    return null;
  }

  // URL parsing silently removes raw control characters and repairs some schemes.
  // Reject those inputs so the saved redirect matches the destination the user entered.
  // eslint-disable-next-line no-control-regex -- Raw control characters must be rejected in destinations.
  if (/[\u0000-\u001f\u007f]/.test(value) || !/^https?:\/\//i.test(value.trim())) return null;

  try {
    const destination = new URL(value.trim());
    if (!['http:', 'https:'].includes(destination.protocol)) return null;
    if (!destination.hostname || destination.username || destination.password) return null;
    return destination.href;
  } catch {
    return null;
  }
}

function parseBaseUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('BASE_URL must be an absolute HTTP or HTTPS URL without credentials.');
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error(
      'BASE_URL must contain only the public origin, without a path, query, or fragment.',
    );
  }
  return parsed.origin;
}

export function createApp({
  store = createStore(),
  baseUrl = process.env.BASE_URL,
  routingQueryKeys = [],
}: AppOptions = {}): Express & { locals: AppLocals } {
  const publicOrigin = parseBaseUrl(baseUrl);
  const app = express();
  const locals = Object.assign(app.locals, { store });
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '16kb' }));

  function serializeLink(link: StoredLink, req: Request): Link {
    const origin = publicOrigin || `${req.protocol}://${req.get('host')}`;
    return { ...link, shortUrl: `${origin}/s/${link.code}` };
  }

  app.get('/api/health', async (req, res: JsonResponse<HealthResponse>) => {
    try {
      await store.check();
    } catch {
      return res.status(503).json({ error: 'Database is unavailable.' });
    }
    res.json({ status: 'ok' });
  });

  app.get('/api/links', async (req, res: JsonResponse<LinksResponse>) => {
    res.json({ links: (await store.list()).map((link) => serializeLink(link, req)) });
  });

  app.get(
    '/api/links/:code/history',
    async (req: Request<CodeParams>, res: JsonResponse<HistoryResponse>) => {
      const days = req.query.days ?? '30';
      if (
        Object.keys(req.query).some((key) => key !== 'days' && !routingQueryKeys.includes(key)) ||
        (days !== '7' && days !== '30')
      ) {
        return res.status(400).json({ error: 'Choose a history range of 7 or 30 days.' });
      }
      const history = await store.history(req.params.code, days === '7' ? 7 : 30);
      if (!history) return res.status(404).json({ error: 'This short link does not exist.' });
      res.json({ history });
    },
  );

  app.post(
    '/api/links',
    async (
      req: Request<Record<string, string>, unknown, unknown>,
      res: JsonResponse<CreateLinkResponse>,
    ) => {
      const body = req.body;
      if (!isRecord(body)) {
        return res.status(400).json({ error: 'Send a JSON object containing a destination URL.' });
      }

      const url = parseDestination(body.url);
      if (!url) {
        return res.status(400).json({
          error: 'Enter a valid HTTP or HTTPS URL without credentials (maximum 8192 characters).',
        });
      }

      const customCode = body.customCode;
      if (
        customCode !== undefined &&
        (typeof customCode !== 'string' || !codePattern.test(customCode))
      ) {
        return res.status(400).json({
          error: 'Custom codes must contain 3–32 letters, numbers, underscores, or hyphens.',
        });
      }

      let link: StoredLink | null = null;
      if (customCode !== undefined) {
        link = await store.create({ code: customCode, url });
        if (!link)
          return res
            .status(409)
            .json({ error: 'That custom code is already in use. Choose another.' });
      } else {
        for (let attempt = 0; attempt < 5 && !link; attempt += 1) {
          link = await store.create({ code: randomBytes(6).toString('base64url'), url });
        }
        if (!link)
          return res
            .status(503)
            .json({ error: 'Could not generate a short code. Please try again.' });
      }

      res.status(201).json({ link: serializeLink(link, req) });
    },
  );

  app.patch(
    '/api/links/:code',
    async (req: Request<CodeParams, unknown, unknown>, res: JsonResponse<UpdateLinkResponse>) => {
      const body = req.body;
      if (!isRecord(body)) {
        return res.status(400).json({ error: 'Send a JSON object containing a destination URL.' });
      }

      const url = parseDestination(body.url);
      if (!url) {
        return res.status(400).json({
          error: 'Enter a valid HTTP or HTTPS URL without credentials (maximum 8192 characters).',
        });
      }

      const link = await store.update(req.params.code, url);
      if (!link) {
        return res.status(404).json({ error: 'This short link does not exist.' });
      }
      res.json({ data: serializeLink(link, req) });
    },
  );

  app.delete(
    '/api/links/:code',
    async (req: Request<CodeParams>, res: Response<ApiErrorResponse>) => {
      if (!(await store.delete(req.params.code))) {
        return res.status(404).json({ error: 'This short link does not exist.' });
      }
      res.status(204).end();
    },
  );

  app.get('/s/:code', async (req: Request<CodeParams>, res) => {
    // HEAD requests inspect availability without counting a user visit.
    const link = await (req.method === 'HEAD'
      ? store.get(req.params.code)
      : store.visit(req.params.code));
    res.set('Cache-Control', 'no-store');
    if (!link)
      return res.status(404).type('text').send('This short link does not exist or was deleted.');
    res.redirect(302, link.url);
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });
  app.use('/s', (req, res) => {
    res.status(404).type('text').send('This short link does not exist or was deleted.');
  });

  app.use(express.static(frontendDirectory, { index: false }));
  app.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) || !req.accepts('html')) return next();
    if (existsSync(frontendIndex)) return res.sendFile(frontendIndex);
    if (req.path === '/') {
      return res
        .status(503)
        .type('text')
        .send('Frontend is not built. Run npm run build, or use npm run dev.');
    }
    next();
  });
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  const handleError: ErrorRequestHandler = (error: unknown, req, res, next) => {
    if (res.headersSent) return next(error);
    if (isRecord(error) && error.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Request body is too large (maximum 16 KB).' });
    }
    if (isRecord(error) && error.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Request body must contain valid JSON.' });
    }
    if (error instanceof URIError) {
      return res.status(400).json({ error: 'Invalid URL encoding.' });
    }
    // Do not log database error objects that may contain query data or connection details.
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined;
    const name = error instanceof Error ? error.name : undefined;
    console.error('Request failed:', code || name || 'UnknownError');
    res.status(500).json({ error: 'An unexpected error occurred. Please try again.' });
  };
  app.use(handleError);

  return Object.assign(app, { locals });
}
