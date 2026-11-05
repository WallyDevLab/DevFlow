import { Logger, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { raw } from 'express';
import helmet from 'helmet';

export const WEBHOOK_PATH = '/api/v1/integrations/github/webhooks';

/** Requests are small JSON documents. Only GitHub webhooks may be larger. */
const DEFAULT_JSON_LIMIT = '100kb';
const WEBHOOK_LIMIT = '5mb';

/**
 * `TRUST_PROXY` tells Express how many reverse proxies sit in front of the
 * API, so `req.ip` (used for rate limiting) is the real client address rather
 * than the proxy's. Use a hop count ("1") or an address list, not "true".
 */
export function parseTrustProxy(value: string | undefined) {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value; // e.g. "loopback" or "10.0.0.0/8"
}

/**
 * HTTP setup shared by the real server (main.ts) and the integration tests,
 * so tests exercise exactly the behaviour production has.
 */
export function configureApp(app: NestExpressApplication) {
  const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
  if (trustProxy !== undefined) app.set('trust proxy', trustProxy);

  // Hides X-Powered-By and adds nosniff, frame, referrer and HSTS headers.
  app.use(
    helmet({
      // The web app lives on a sibling origin and reads responses via CORS.
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  // GitHub signs the exact bytes it sends, so the webhook route receives the
  // body untouched and the controller verifies the signature BEFORE parsing
  // it. This stops unauthenticated callers from making the server parse
  // large JSON documents. It is registered ahead of the global JSON parser.
  app.use(WEBHOOK_PATH, raw({ type: () => true, limit: WEBHOOK_LIMIT }));
  app.useBodyParser('json', { limit: DEFAULT_JSON_LIMIT });

  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  });

  if (process.env.NODE_ENV === 'production' && trustProxy === undefined) {
    new Logger('Security').warn(
      'TRUST_PROXY is not set. Behind a reverse proxy every client will appear to share one IP, so rate limits will apply to everyone at once. Set TRUST_PROXY to the number of proxies in front of the API.',
    );
  }
  return app;
}
