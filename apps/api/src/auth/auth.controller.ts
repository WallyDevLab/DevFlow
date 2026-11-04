import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { LoginDto, RegisterDto } from './auth.dto.js';
import { AuthService, REFRESH_TTL_MS } from './auth.service.js';
import { type AuthedRequest, JwtAuthGuard } from './jwt-auth.guard.js';

const COOKIE = 'refresh_token';
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/api/v1/auth',
};

// Strict limit on credential endpoints to slow brute-force attempts.
const AUTH_LIMIT = { default: { limit: 5, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Throttle(AUTH_LIMIT)
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.register(dto));
  }

  @Throttle(AUTH_LIMIT)
  @HttpCode(200)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.login(dto));
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.refresh(req.cookies?.[COOKIE]));
  }

  @HttpCode(204)
  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(req.cookies?.[COOKIE]);
    res.clearCookie(COOKIE, cookieOptions);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: AuthedRequest) {
    return this.auth.getProfile(req.user.id);
  }

  private respond(
    res: Response,
    tokens: { accessToken: string; refreshToken: string; user: unknown },
  ) {
    res.cookie(COOKIE, tokens.refreshToken, {
      ...cookieOptions,
      maxAge: REFRESH_TTL_MS,
    });
    return { accessToken: tokens.accessToken, user: tokens.user };
  }
}
