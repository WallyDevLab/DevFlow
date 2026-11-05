import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  UpdateProfileDto,
  VerifyEmailDto,
} from './auth.dto.js';
import { AuthService, REFRESH_TTL_MS } from './auth.service.js';
import { type AuthedRequest, JwtAuthGuard } from './jwt-auth.guard.js';
import { OriginGuard } from './origin.guard.js';

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
  @UseGuards(OriginGuard)
  @HttpCode(200)
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(res, await this.auth.refresh(req.cookies?.[COOKIE]));
  }

  @UseGuards(OriginGuard)
  @HttpCode(204)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[COOKIE]);
    res.clearCookie(COOKIE, cookieOptions);
  }

  @Throttle(AUTH_LIMIT)
  @HttpCode(202)
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email);
    // Same answer whether or not the address exists.
    return {
      message: 'If that email is registered, a reset link is on its way.',
    };
  }

  @Throttle(AUTH_LIMIT)
  @HttpCode(204)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.password);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(204)
  @Post('verify-email')
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.auth.verifyEmail(dto.token);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle(AUTH_LIMIT)
  @HttpCode(202)
  @Post('resend-verification')
  async resendVerification(@Req() req: AuthedRequest) {
    await this.auth.resendVerification(req.user.id);
    return {
      message:
        'If your address still needs verifying, a new link is on its way.',
    };
  }

  @UseGuards(JwtAuthGuard)
  @Throttle(AUTH_LIMIT)
  @HttpCode(200)
  @Post('change-password')
  async changePassword(
    @Req() req: AuthedRequest,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(
      res,
      await this.auth.changePassword(
        req.user.id,
        dto.currentPassword,
        dto.newPassword,
      ),
    );
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateProfile(@Req() req: AuthedRequest, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(req.user.id, dto.name);
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
