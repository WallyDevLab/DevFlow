import { Logger } from '@nestjs/common';

const PLACEHOLDER = /change[-_ ]?me|your[-_ ]?secret|replace[-_ ]?me|example/i;

/**
 * Checks configuration at startup so an insecure deployment fails loudly
 * instead of running. In production it refuses a weak or placeholder
 * JWT_SECRET and a non-HTTPS web origin (NFR-03). In development it only warns.
 */
export function validateEnv(env: Record<string, unknown>) {
  const nodeEnv = typeof env.NODE_ENV === 'string' ? env.NODE_ENV : '';
  const production = nodeEnv === 'production';
  const secret = typeof env.JWT_SECRET === 'string' ? env.JWT_SECRET : '';
  const origin = typeof env.WEB_ORIGIN === 'string' ? env.WEB_ORIGIN : '';
  const problems: string[] = [];

  if (!env.DATABASE_URL) problems.push('DATABASE_URL is required');
  if (!secret) problems.push('JWT_SECRET is required');

  if (production) {
    if (secret && secret.length < 32) {
      problems.push('JWT_SECRET must be at least 32 characters in production');
    }
    if (secret && PLACEHOLDER.test(secret)) {
      problems.push(
        'JWT_SECRET looks like a placeholder; generate a random one',
      );
    }
    if (!origin) {
      problems.push(
        'WEB_ORIGIN is required in production (the web app’s https:// address)',
      );
    } else if (!origin.startsWith('https://')) {
      problems.push('WEB_ORIGIN must be an https:// URL in production');
    }
  } else {
    const log = new Logger('Security');
    if (!nodeEnv) {
      log.warn(
        'NODE_ENV is not set, so the API runs in development mode: cookies are not marked Secure and emails (including one-time links) are printed to the console. Set NODE_ENV=production in production.',
      );
    }
    if (secret && secret.length < 32 && nodeEnv !== 'test') {
      log.warn(
        'JWT_SECRET is shorter than 32 characters; use a long random value.',
      );
    }
  }

  if (problems.length) {
    throw new Error(
      `Invalid environment configuration:\n - ${problems.join('\n - ')}`,
    );
  }
  return env;
}
