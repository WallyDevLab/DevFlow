import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { NotificationType } from '@prisma/client';
import { AccessService } from '../access/access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const NOTIFICATION_KINDS: {
  type: NotificationType;
  label: string;
  description: string;
}[] = [
  {
    type: 'TASK_ASSIGNED',
    label: 'Assigned to me',
    description: 'Someone assigns a task to you.',
  },
  {
    type: 'MENTION',
    label: 'Mentions',
    description: 'Someone @mentions you in a comment.',
  },
  {
    type: 'TASK_BLOCKED',
    label: 'Blocked tasks',
    description: 'A task you’re assigned to or reported is marked blocked.',
  },
  {
    type: 'SPRINT_STARTED',
    label: 'Sprint started',
    description: 'A sprint with your tasks begins.',
  },
  {
    type: 'SPRINT_COMPLETED',
    label: 'Sprint completed',
    description: 'A sprint with your tasks finishes.',
  },
  {
    type: 'PULL_REQUEST',
    label: 'Pull request updates',
    description:
      'Linked pull requests are opened, reviewed, fail checks or merge.',
  },
];

const clip = (s: string, n = 70) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;
export const taskLabel = (key: string, title: string) =>
  `${key} “${clip(title)}”`;

export interface NotifyInput {
  type: NotificationType;
  recipients: (string | null | undefined)[];
  /** Never notified about their own action. */
  actorId?: string;
  workspaceId: string;
  message: string;
  link: string;
}

@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  /**
   * Best-effort: a failure here is logged but never breaks the action that
   * caused it. Recipients must still be workspace members, and a user's own
   * actions and disabled notification types are skipped.
   */
  async notify(input: NotifyInput) {
    try {
      const ids = [
        ...new Set(input.recipients.filter((r): r is string => !!r)),
      ].filter((id) => id !== input.actorId);
      if (!ids.length) return;
      const members = await this.prisma.workspaceMember.findMany({
        where: { workspaceId: input.workspaceId, userId: { in: ids } },
        select: { userId: true },
      });
      const memberIds = members.map((m) => m.userId);
      const off = await this.prisma.notificationPreference.findMany({
        where: { userId: { in: memberIds }, type: input.type, inApp: false },
        select: { userId: true },
      });
      const muted = new Set(off.map((p) => p.userId));
      const targets = memberIds.filter((id) => !muted.has(id));
      if (!targets.length) return;
      await this.prisma.notification.createMany({
        data: targets.map((userId) => ({
          userId,
          workspaceId: input.workspaceId,
          type: input.type,
          message: input.message,
          link: input.link,
          actorId: input.actorId,
        })),
      });
    } catch (err) {
      this.log.error(
        `Failed to create ${input.type} notification: ${(err as Error).message}`,
      );
    }
  }

  async nameOf(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    return u?.name ?? 'Someone';
  }

  // Notifications from workspaces the user has since left are hidden.
  private async visibleWorkspaces(userId: string) {
    const m = await this.prisma.workspaceMember.findMany({
      where: { userId },
      select: { workspaceId: true },
    });
    return m.map((x) => x.workspaceId);
  }

  async list(userId: string, opts: { unreadOnly: boolean; limit: number }) {
    const workspaceIds = await this.visibleWorkspaces(userId);
    const base = { userId, workspaceId: { in: workspaceIds } };
    const [items, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { ...base, ...(opts.unreadOnly ? { readAt: null } : {}) },
        orderBy: { createdAt: 'desc' },
        take: opts.limit,
        select: {
          id: true,
          type: true,
          message: true,
          link: true,
          readAt: true,
          createdAt: true,
        },
      }),
      this.prisma.notification.count({ where: { ...base, readAt: null } }),
    ]);
    return { items, unreadCount };
  }

  async unreadCount(userId: string) {
    const workspaceIds = await this.visibleWorkspaces(userId);
    return {
      unreadCount: await this.prisma.notification.count({
        where: { userId, workspaceId: { in: workspaceIds }, readAt: null },
      }),
    };
  }

  async markRead(userId: string, id: string) {
    // Scoped by userId so nobody can touch another user's notification.
    const { count } = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (!count) {
      const exists = await this.prisma.notification.count({
        where: { id, userId },
      });
      if (!exists) throw new NotFoundException('Notification not found');
    }
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async preferences(userId: string) {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId },
    });
    const byType = new Map(rows.map((r) => [r.type, r.inApp]));
    return NOTIFICATION_KINDS.map((k) => ({
      ...k,
      inApp: byType.get(k.type) ?? true,
    }));
  }

  async setPreference(userId: string, type: NotificationType, inApp: boolean) {
    await this.prisma.notificationPreference.upsert({
      where: { userId_type: { userId, type } },
      create: { userId, type, inApp },
      update: { inApp },
    });
  }

  /** Recent task activity across a workspace's projects (NOT-07). */
  async activityFeed(userId: string, workspaceId: string) {
    await this.access.workspaceRole(userId, workspaceId);
    const rows = await this.prisma.taskActivity.findMany({
      where: { task: { project: { workspaceId } } },
      orderBy: { createdAt: 'desc' },
      take: 40,
      include: {
        task: {
          select: {
            id: true,
            number: true,
            title: true,
            project: { select: { key: true } },
          },
        },
      },
    });
    const actorIds = [
      ...new Set(rows.map((r) => r.actorId).filter((a) => a !== 'github')),
    ];
    const users = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      data: r.data,
      actor:
        r.actorId === 'github' ? 'GitHub' : (names.get(r.actorId) ?? 'Someone'),
      taskId: r.task.id,
      taskKey: `${r.task.project.key}-${r.task.number}`,
      taskTitle: r.task.title,
      createdAt: r.createdAt,
    }));
  }
}
