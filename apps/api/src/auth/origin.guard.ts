import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/**
 * Defence in depth for the endpoints that act on the refresh-token cookie.
 * The cookie is SameSite=Strict, and on top of that a browser request that
 * names a different Origin is refused. Requests without an Origin header
 * (tools, servers) are unaffected, but they can't send the cookie cross-site
 * anyway.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    const origin = req.headers.origin;
    const allowed =
      this.config.get<string>('WEB_ORIGIN') ?? 'http://localhost:3000';
    if (origin && origin !== allowed) {
      throw new ForbiddenException('Cross-origin request refused');
    }
    return true;
  }
}
