import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { WorkspaceRole } from '@prisma/client';
import { EmailService } from '../email/email.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AssignableRole } from './workspaces.dto.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MANAGERS: WorkspaceRole[] = ['OWNER', 'ADMIN'];
const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  /** Returns the caller's role, or 404 so non-members can't probe for workspaces. */
  private async requireRole(userId: string, workspaceId: string) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });
    if (!member) throw new NotFoundException('Workspace not found');
    return member.role;
  }

  private async requireManager(userId: string, workspaceId: string) {
    const role = await this.requireRole(userId, workspaceId);
    if (!MANAGERS.includes(role)) {
      throw new ForbiddenException('Only owners and admins can do this');
    }
    return role;
  }

  private audit(
    workspaceId: string,
    actorId: string,
    action: string,
    metadata?: Record<string, string>,
  ) {
    return this.prisma.auditLog.create({
      data: { workspaceId, actorId, action, metadata },
    });
  }

  async create(userId: string, name: string) {
    return this.prisma.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: { name, members: { create: { userId, role: 'OWNER' } } },
      });
      await tx.auditLog.create({
        data: {
          workspaceId: workspace.id,
          actorId: userId,
          action: 'workspace.created',
        },
      });
      return { id: workspace.id, name: workspace.name, role: 'OWNER' as const };
    });
  }

  async listForUser(userId: string) {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      role: m.role,
    }));
  }

  async get(userId: string, workspaceId: string) {
    const role = await this.requireRole(userId, workspaceId);
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
    });
    return { id: workspace.id, name: workspace.name, role };
  }

  async listMembers(userId: string, workspaceId: string) {
    await this.requireRole(userId, workspaceId);
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
    }));
  }

  async updateRole(
    userId: string,
    workspaceId: string,
    targetId: string,
    role: AssignableRole,
  ) {
    const caller = await this.requireRole(userId, workspaceId);
    if (caller !== 'OWNER') {
      throw new ForbiddenException('Only the workspace owner can change roles');
    }
    const target = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: targetId, workspaceId } },
    });
    if (!target) throw new NotFoundException('Member not found');
    if (target.role === 'OWNER') {
      throw new BadRequestException("The owner's role can't be changed");
    }
    await this.prisma.workspaceMember.update({
      where: { id: target.id },
      data: { role },
    });
    await this.audit(workspaceId, userId, 'member.role_changed', {
      targetId,
      from: target.role,
      to: role,
    });
  }

  async removeMember(userId: string, workspaceId: string, targetId: string) {
    const caller = await this.requireRole(userId, workspaceId);
    const target = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: targetId, workspaceId } },
    });
    if (!target) throw new NotFoundException('Member not found');

    const leaving = targetId === userId;
    if (target.role === 'OWNER') {
      throw new BadRequestException("The workspace owner can't be removed");
    }
    if (!leaving) {
      if (!MANAGERS.includes(caller)) {
        throw new ForbiddenException(
          'Only owners and admins can remove members',
        );
      }
      if (caller === 'ADMIN' && target.role === 'ADMIN') {
        throw new ForbiddenException('Admins can’t remove other admins');
      }
    }
    await this.prisma.workspaceMember.delete({ where: { id: target.id } });
    await this.audit(workspaceId, userId, 'member.removed', { targetId });
  }

  async invite(
    userId: string,
    workspaceId: string,
    email: string,
    role: AssignableRole,
  ) {
    const caller = await this.requireManager(userId, workspaceId);
    if (role === 'ADMIN' && caller !== 'OWNER') {
      throw new ForbiddenException('Only the owner can invite admins');
    }
    const existingMember = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId, user: { email } },
    });
    if (existingMember) throw new ConflictException('Already a member');

    const token = randomBytes(32).toString('base64url');
    const invitation = await this.prisma.$transaction(async (tx) => {
      // One pending invitation per email: a new one replaces the old.
      await tx.invitation.deleteMany({
        where: { workspaceId, email, acceptedAt: null },
      });
      return tx.invitation.create({
        data: {
          workspaceId,
          email,
          role,
          token: hashToken(token),
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        },
      });
    });
    await this.audit(workspaceId, userId, 'member.invited', { email, role });

    const [workspace, inviter] = await Promise.all([
      this.prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    ]);
    // `emailed` is true only when mail really left the server (SMTP set up);
    // otherwise the inviter shares the link themselves.
    const emailed = await this.email.send({
      to: email,
      subject: `${inviter.name} invited you to ${workspace.name} on DevFlow`,
      text:
        `${inviter.name} invited you to join “${workspace.name}” on DevFlow as ${role.toLowerCase().replace('_', ' ')}.\n\n` +
        `Accept the invitation (it expires in 7 days):\n${this.email.webUrl}/invite?token=${token}\n\n` +
        `You'll need to sign in or create an account using ${email}.`,
    });
    // The raw token is only ever returned here; only its hash is stored.
    return {
      id: invitation.id,
      email,
      role,
      expiresAt: invitation.expiresAt,
      token,
      emailed,
    };
  }

  async listInvitations(userId: string, workspaceId: string) {
    await this.requireManager(userId, workspaceId);
    return this.prisma.invitation.findMany({
      where: { workspaceId, acceptedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, email: true, role: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeInvitation(userId: string, workspaceId: string, id: string) {
    await this.requireManager(userId, workspaceId);
    const { count } = await this.prisma.invitation.deleteMany({
      where: { id, workspaceId, acceptedAt: null },
    });
    if (!count) throw new NotFoundException('Invitation not found');
  }

  async acceptInvitation(userId: string, email: string, token: string) {
    // Invitations are matched by email address, so the address must be one the
    // user has proven they control (otherwise anyone could register someone
    // else's address and accept invitations meant for them).
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true },
    });
    if (!account?.emailVerifiedAt) {
      throw new ForbiddenException(
        'Verify your email address before accepting an invitation',
      );
    }
    const invitation = await this.prisma.invitation.findUnique({
      where: { token: hashToken(token) },
    });
    // Same error for every failure so tokens can't be probed.
    const invalid = new BadRequestException('Invitation is invalid or expired');
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.expiresAt < new Date() ||
      invitation.email !== email.toLowerCase()
    ) {
      throw invalid;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.workspaceMember.upsert({
        where: {
          userId_workspaceId: { userId, workspaceId: invitation.workspaceId },
        },
        create: {
          userId,
          workspaceId: invitation.workspaceId,
          role: invitation.role,
        },
        update: {},
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          workspaceId: invitation.workspaceId,
          actorId: userId,
          action: 'invitation.accepted',
        },
      });
    });
    return { workspaceId: invitation.workspaceId };
  }
}
