import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env.js';
import { AuthModule } from './auth/auth.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { EmailModule } from './email/email.module.js';
import { AccessModule } from './access/access.module.js';
import { GitHubModule } from './github/github.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { ProjectsModule } from './projects/projects.module.js';
import { WorkspacesModule } from './workspaces/workspaces.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
      // Integration tests create many accounts quickly. This switch only works
      // when NODE_ENV is 'test', so it can never be enabled in production.
      skipIf: () =>
        process.env.NODE_ENV === 'test' &&
        process.env.DISABLE_THROTTLE === 'true',
    }),
    PrismaModule,
    AccessModule,
    EmailModule,
    NotificationsModule,
    AuthModule,
    WorkspacesModule,
    ProjectsModule,
    GitHubModule,
    AnalyticsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
