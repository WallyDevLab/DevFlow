import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';
import type { Request } from 'express';
import { type AuthedRequest, JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { GitHubService } from './github.service.js';
import { WebhooksService } from './webhooks.service.js';

class CompleteInstallDto {
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  installationId: number;

  @IsString()
  @MaxLength(200)
  code: string;

  @IsString()
  @MaxLength(1000)
  state: string;
}

class LinkRepositoryDto {
  @IsString()
  @MaxLength(200)
  fullName: string;
}

const uuid = () => new ParseUUIDPipe();

@Controller()
export class GitHubController {
  constructor(
    private readonly github: GitHubService,
    private readonly webhooks: WebhooksService,
  ) {}

  /**
   * Called by GitHub. Authenticated by the HMAC signature, not a user token.
   * The body arrives as raw bytes (see configureApp) so it is verified before
   * anything is parsed. The limit is generous because deliveries come from a
   * shared pool of GitHub addresses, but it still bounds abuse.
   */
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @HttpCode(202)
  @Post('integrations/github/webhooks')
  async webhook(
    @Req() req: Request,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Headers('x-github-event') event: string | undefined,
    @Headers('x-github-delivery') delivery: string | undefined,
  ) {
    const body: unknown = req.body;
    const rawBody = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
    if (!this.webhooks.verifySignature(rawBody, signature)) {
      throw new UnauthorizedException('Invalid signature');
    }
    if (!event || !delivery) {
      throw new BadRequestException('Missing GitHub headers');
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Expected a JSON payload');
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new BadRequestException('Expected a JSON payload');
    }
    return this.webhooks.ingest(
      delivery,
      event,
      payload as Record<string, unknown>,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('workspaces/:id/integrations/github')
  status(@Req() req: AuthedRequest, @Param('id', uuid()) id: string) {
    return this.github.status(req.user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('workspaces/:id/integrations/github')
  disconnect(@Req() req: AuthedRequest, @Param('id', uuid()) id: string) {
    return this.github.disconnect(req.user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('workspaces/:id/integrations/github/repositories')
  repositories(@Req() req: AuthedRequest, @Param('id', uuid()) id: string) {
    return this.github.listRepositories(req.user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  @Post('integrations/github/installations')
  completeInstall(@Req() req: AuthedRequest, @Body() dto: CompleteInstallDto) {
    return this.github.completeInstall(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Put('projects/:id/repository')
  link(
    @Req() req: AuthedRequest,
    @Param('id', uuid()) id: string,
    @Body() dto: LinkRepositoryDto,
  ) {
    return this.github.linkRepository(req.user.id, id, dto.fullName);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  @Delete('projects/:id/repository')
  unlink(@Req() req: AuthedRequest, @Param('id', uuid()) id: string) {
    return this.github.unlinkRepository(req.user.id, id);
  }
}
