import { validateEnv } from './env.js';

const good = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@db:5432/app',
  JWT_SECRET: 'k3Jx9vQ2mZpL7wRtYb5NcHd8FsUa4GeX',
  WEB_ORIGIN: 'https://app.example.org',
};

describe('validateEnv', () => {
  it('accepts a sound production configuration', () => {
    expect(() => validateEnv(good)).not.toThrow();
  });

  it.each([
    ['a short secret', { JWT_SECRET: 'short' }, /at least 32/],
    [
      'a placeholder secret',
      { JWT_SECRET: 'change-me-to-a-long-random-string-xxxx' },
      /placeholder/,
    ],
    [
      'a missing web origin',
      { WEB_ORIGIN: undefined },
      /WEB_ORIGIN is required/,
    ],
    [
      'a plain-http web origin',
      { WEB_ORIGIN: 'http://app.example.org' },
      /https/,
    ],
    ['a missing database url', { DATABASE_URL: undefined }, /DATABASE_URL/],
    ['a missing secret', { JWT_SECRET: undefined }, /JWT_SECRET is required/],
  ])('refuses %s in production', (_name, override, message) => {
    expect(() => validateEnv({ ...good, ...override })).toThrow(message);
  });

  it('reports every problem at once', () => {
    expect(() =>
      validateEnv({ NODE_ENV: 'production', JWT_SECRET: 'x' }),
    ).toThrow(/DATABASE_URL[\s\S]*JWT_SECRET[\s\S]*WEB_ORIGIN/);
  });

  it('is lenient in development, so local setup stays easy', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://x',
        JWT_SECRET: 'dev',
      }),
    ).not.toThrow();
    expect(() =>
      validateEnv({ DATABASE_URL: 'x', JWT_SECRET: 'dev' }),
    ).not.toThrow();
  });
});
