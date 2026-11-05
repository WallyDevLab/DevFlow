import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { EmailService } from '../email/email.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { LoginDto, RegisterDto } from './auth.dto.js';

const RESET_TTL_MS = 60 * 60 * 1000;
const RESET_COOLDOWN_MS = 60 * 1000;

// After this many consecutive failures an account refuses sign-ins for a while,
// on top of the per-IP rate limit (which a spread-out attacker can sidestep).
export const MAX_FAILED_LOGINS = 10;
export const LOCKOUT_MS = 15 * 60 * 1000;

export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// A low cost keeps the test suite fast; production always uses 12.
const BCRYPT_COST = process.env.NODE_ENV === 'test' ? 4 : 12;
// Compared against when the email is unknown so response time doesn't reveal
// which emails are registered.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);

const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

// Verification links last a day; asking again within a minute does nothing,
// so the endpoint can't be used to flood someone's inbox.
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const VERIFY_COOLDOWN_MS = 60 * 1000;

/** What a database user needs for the public shape and for signing in. */
interface UserRecord {
  id: string;
  email: string;
  name: string;
  emailVerifiedAt: Date | null;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException('Email is already registered');

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        passwordHash: await bcrypt.hash(dto.password, BCRYPT_COST),
      },
    });
    // Sent in the background: a mail problem must never fail sign-up.
    void this.sendVerification(user);
    return this.issueTokens(user);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    const valid = await bcrypt.compare(
      dto.password,
      user?.passwordHash ?? DUMMY_HASH,
    );
    // A locked account answers exactly like a wrong password, so the lock
    // can't be used to confirm an account exists or to test guesses.
    const locked = !!user?.lockedUntil && user.lockedUntil > new Date();
    if (!user || locked || !valid) {
      if (user && !locked) await this.recordFailedLogin(user.id);
      throw new UnauthorizedException('Invalid credentials');
    }
    if (user.failedLogins > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: 0, lockedUntil: null },
      });
    }
    return this.issueTokens(user);
  }

  private async recordFailedLogin(userId: string) {
    const { failedLogins } = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLogins: { increment: 1 } },
      select: { failedLogins: true },
    });
    if (failedLogins >= MAX_FAILED_LOGINS) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          failedLogins: 0,
          lockedUntil: new Date(Date.now() + LOCKOUT_MS),
        },
      });
    }
  }

  /** Rotates the refresh token. Reuse of a revoked token revokes the whole family. */
  async refresh(rawToken: string | undefined) {
    if (!rawToken) throw new UnauthorizedException();
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: true },
    });
    if (!stored) throw new UnauthorizedException();

    if (stored.revokedAt) {
      await this.revokeAll(stored.userId);
      throw new UnauthorizedException();
    }
    if (stored.expiresAt < new Date()) throw new UnauthorizedException();

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    return this.issueTokens(stored.user);
  }

  async logout(rawToken: string | undefined) {
    if (!rawToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async getProfile(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return this.toPublic(user);
  }

  // ---- Email verification ----------------------------------------------

  /** Issues a fresh link (older ones stop working) and emails it. */
  private async sendVerification(user: UserRecord) {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.emailVerificationToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
        },
      }),
    ]);
    await this.email.send({
      to: user.email,
      subject: 'Confirm your email address for DevFlow',
      text:
        `Hi ${user.name},\n\nConfirm that this is your email address so you can accept workspace invitations. The link expires in 24 hours and works once:\n\n` +
        `${this.email.webUrl}/verify-email?token=${token}\n\n` +
        'If you didn’t create a DevFlow account, you can ignore this email.',
    });
  }

  /** Re-sends the link for the signed-in user. Quietly does nothing if already verified or asked too recently. */
  async resendVerification(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (user.emailVerifiedAt) return;
    const recent = await this.prisma.emailVerificationToken.findFirst({
      where: {
        userId,
        createdAt: { gt: new Date(Date.now() - VERIFY_COOLDOWN_MS) },
      },
    });
    if (recent) return;
    await this.sendVerification(user);
  }

  /** Public on purpose: the one-time link in the email is the credential. */
  async verifyEmail(token: string) {
    const invalid = new BadRequestException(
      'This verification link is invalid or has expired',
    );
    const stored = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!stored || stored.usedAt || stored.expiresAt < new Date())
      throw invalid;
    await this.prisma.$transaction(async (tx) => {
      // Claim first, so two simultaneous requests can't both succeed.
      const claimed = await tx.emailVerificationToken.updateMany({
        where: { id: stored.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 0) throw invalid;
      await tx.user.updateMany({
        where: { id: stored.userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: new Date() },
      });
    });
  }

  // ---- Password reset & account ----------------------------------------

  /**
   * Always resolves the same way whether or not the address is registered, so
   * it can't be used to discover accounts. Mail is sent in the background.
   */
  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      await bcrypt.compare('padding', DUMMY_HASH); // similar timing to the real path
      return;
    }
    // Cool-down so the endpoint can't be used to flood someone's inbox.
    const recent = await this.prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        createdAt: { gt: new Date(Date.now() - RESET_COOLDOWN_MS) },
      },
    });
    if (recent) return;

    const token = randomBytes(32).toString('base64url');
    await this.prisma.$transaction([
      // Only the newest link works.
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + RESET_TTL_MS),
        },
      }),
    ]);
    void this.email.send({
      to: user.email,
      subject: 'Reset your DevFlow password',
      text:
        `Hi ${user.name},\n\nUse this link to choose a new password. It expires in 1 hour and works once:\n\n` +
        `${this.email.webUrl}/reset-password?token=${token}\n\n` +
        'If you didn’t ask for this, you can ignore this email; your password hasn’t changed.',
    });
  }

  async resetPassword(token: string, password: string) {
    const invalid = new BadRequestException(
      'This reset link is invalid or has expired',
    );
    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!stored || stored.usedAt || stored.expiresAt < new Date())
      throw invalid;

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    await this.prisma.$transaction(async (tx) => {
      // Claim the token first; if two requests race, only one gets count 1.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: stored.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 0) throw invalid;
      await tx.user.update({
        where: { id: stored.userId },
        data: {
          passwordHash,
          failedLogins: 0,
          lockedUntil: null,
          emailVerifiedAt: stored.user.emailVerifiedAt ?? new Date(),
        },
      });
      // Sign out everywhere: whoever had the old password loses their sessions.
      // Deleted (not just revoked) so a stale cookie gets a plain 401 instead of
      // tripping the stolen-token check, which would revoke the new session too.
      await tx.refreshToken.deleteMany({ where: { userId: stored.userId } });
    });
    void this.notifyPasswordChanged(stored.user);
  }

  async changePassword(userId: string, current: string, next: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    if (!(await bcrypt.compare(current, user.passwordHash))) {
      throw new BadRequestException('Your current password is incorrect');
    }
    if (current === next) {
      throw new BadRequestException(
        'Choose a password different from your current one',
      );
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: await bcrypt.hash(next, BCRYPT_COST),
        failedLogins: 0,
        lockedUntil: null,
      },
    });
    // Deleted rather than revoked: see resetPassword.
    await this.prisma.refreshToken.deleteMany({ where: { userId } });
    void this.notifyPasswordChanged(user);
    // Other devices are signed out; this one gets a fresh session.
    return this.issueTokens(user);
  }

  async updateProfile(userId: string, name: string): Promise<PublicUser> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { name },
    });
    return this.toPublic(user);
  }

  private notifyPasswordChanged(user: { email: string; name: string }) {
    return this.email.send({
      to: user.email,
      subject: 'Your DevFlow password was changed',
      text:
        `Hi ${user.name},\n\nYour DevFlow password was just changed and you were signed out on other devices. ` +
        'If this wasn’t you, reset your password right away.',
    });
  }

  private revokeAll(userId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private toPublic(user: UserRecord): PublicUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerifiedAt !== null,
    };
  }

  private async issueTokens(user: UserRecord) {
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
    });
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    return { accessToken, refreshToken, user: this.toPublic(user) };
  }
}
