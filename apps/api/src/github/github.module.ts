import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { GitHubApiService } from './github-api.service.js';
import { GitHubController } from './github.controller.js';
import { GitHubService } from './github.service.js';
import { WebhooksService } from './webhooks.service.js';

@Module({
  imports: [AuthModule],
  controllers: [GitHubController],
  providers: [GitHubApiService, GitHubService, WebhooksService],
})
export class GitHubModule {}
