import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { EmailService, type Email } from '../../src/email/email.service.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';

/** Captures outgoing email instead of sending it. */
export class Mailbox {
  sent: Email[] = [];
  delivers = false;
  webUrl = 'http://localhost:3000';

  send(email: Email) {
    this.sent.push(email);
    return Promise.resolve(false);
  }

  to(address: string, subject?: RegExp) {
    return this.sent.filter(
      (e) => e.to === address && (!subject || subject.test(e.subject)),
    );
  }

  /** The first capture group of `pattern` in the latest email to `address` that matches it. */
  extract(address: string, pattern: RegExp) {
    for (const email of this.to(address).reverse()) {
      const match = pattern.exec(email.text);
      if (match) return match[1];
    }
    return null;
  }
}

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

export function makeClient(app: NestExpressApplication) {
  const server = app.getHttpServer();
  /** An HTTP client acting as the user holding `token` (or anonymous). */
  return (token?: string) => {
    const call = (method: Method) => (url: string, body?: object) => {
      let req = request(server)[method](`/api/v1${url}`);
      if (token) req = req.set('Authorization', `Bearer ${token}`);
      return body ? req.send(body) : req;
    };
    return {
      get: call('get'),
      post: call('post'),
      patch: call('patch'),
      put: call('put'),
      delete: call('delete'),
    };
  };
}

/** The HTTP client, plus the captured mailbox so helpers can complete email flows. */
export type Api = ReturnType<typeof makeClient> & { mailbox: Mailbox };

/** Boots the real application against the test database. */
export async function createApp() {
  const mailbox = new Mailbox();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EmailService)
    .useValue(mailbox)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    rawBody: true,
  });
  configureApp(app);
  await app.init();
  return {
    app,
    mailbox,
    prisma: app.get(PrismaService),
    api: Object.assign(makeClient(app), { mailbox }),
    server: app.getHttpServer(),
  };
}
