import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AccessService,
  canEditTasks,
  canPlan,
} from '../access/access.service.js';
import {
  NotificationsService,
  taskLabel,
} from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const MAX_LABELS_PER_PROJECT = 50;

@Injectable()
export class CollabService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---- Labels ------------------------------------------------------------

  async listLabels(userId: string, projectId: string) {
    await this.access.project(userId, projectId);
    return this.prisma.label.findMany({
      where: { projectId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, color: true },
    });
  }

  async createLabel(
    userId: string,
    projectId: string,
    name: string,
    color: string,
  ) {
    const { role } = await this.access.project(userId, projectId);
    if (!canEditTasks(role)) throw new ForbiddenException('Read-only access');
    const existing = await this.prisma.label.findMany({
      where: { projectId },
      select: { name: true },
    });
    if (existing.length >= MAX_LABELS_PER_PROJECT) {
      throw new BadRequestException(
        `A project can have at most ${MAX_LABELS_PER_PROJECT} labels`,
      );
    }
    if (existing.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
      throw new ConflictException(`A label named “${name}” already exists`);
    }
    return this.prisma.label.create({
      data: { projectId, name, color: color.toLowerCase() },
      select: { id: true, name: true, color: true },
    });
  }

  private async labelAccess(userId: string, labelId: string) {
    const label = await this.prisma.label.findUnique({
      where: { id: labelId },
      include: { project: true },
    });
    if (!label) throw new NotFoundException('Label not found');
    const role = await this.access
      .workspaceRole(userId, label.project.workspaceId)
      .catch(() => {
        throw new NotFoundException('Label not found');
      });
    return { label, role };
  }

  async updateLabel(
    userId: string,
    labelId: string,
    dto: { name?: string; color?: string },
  ) {
    const { label, role } = await this.labelAccess(userId, labelId);
    if (!canPlan(role)) {
      throw new ForbiddenException(
        'Only owners, admins, scrum masters and product owners can edit labels',
      );
    }
    if (dto.name) {
      // Same case-insensitive rule as creating a label (the database
      // constraint alone would allow "Bug" next to "bug").
      const clash = await this.prisma.label.findFirst({
        where: {
          projectId: label.projectId,
          id: { not: labelId },
          name: { equals: dto.name, mode: 'insensitive' },
        },
      });
      if (clash)
        throw new ConflictException(
          `A label named “${dto.name}” already exists`,
        );
    }
    try {
      return await this.prisma.label.update({
        where: { id: labelId },
        data: { name: dto.name, color: dto.color?.toLowerCase() },
        select: { id: true, name: true, color: true },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          `A label named “${dto.name}” already exists`,
        );
      }
      throw err;
    }
  }

  async deleteLabel(userId: string, labelId: string) {
    const { role } = await this.labelAccess(userId, labelId);
    if (!canPlan(role)) {
      throw new ForbiddenException(
        'Only owners, admins, scrum masters and product owners can delete labels',
      );
    }
    await this.prisma.label.delete({ where: { id: labelId } });
  }

  // ---- Comments ----------------------------------------------------------

  async listComments(userId: string, taskId: string) {
    const { role } = await this.access.task(userId, taskId);
    const comments = await this.prisma.taskComment.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, name: true } } },
    });
    return comments.map((c) => ({
      id: c.id,
      body: c.body,
      author: c.author,
      createdAt: c.createdAt,
      edited: c.edited,
      canEdit: c.authorId === userId && canEditTasks(role),
      canDelete: c.authorId === userId || canPlan(role),
    }));
  }

  /**
   * Mentioned users who are workspace members AND are actually named in the
   * text as "@Name" (so a mention can't be forged without being visible).
   */
  private async validMentions(
    workspaceId: string,
    body: string,
    ids: string[] = [],
  ) {
    if (!ids.length) return [];
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, userId: { in: ids } },
      include: { user: { select: { id: true, name: true } } },
    });
    return members
      .filter((m) => body.includes(`@${m.user.name}`))
      .map((m) => ({ id: m.user.id, name: m.user.name }));
  }

  private async notifyMentions(
    actorId: string,
    task: { id: string; number: number; title: string },
    project: { key: string; workspaceId: string },
    recipients: string[],
  ) {
    if (!recipients.length) return;
    const actor = await this.notifications.nameOf(actorId);
    await this.notifications.notify({
      type: 'MENTION',
      recipients,
      actorId,
      workspaceId: project.workspaceId,
      message: `${actor} mentioned you in a comment on ${taskLabel(`${project.key}-${task.number}`, task.title)}`,
      link: `/tasks/${task.id}`,
    });
  }

  async addComment(
    userId: string,
    taskId: string,
    body: string,
    mentionIds?: string[],
  ) {
    const { task, project, role } = await this.access.task(userId, taskId);
    if (!canEditTasks(role)) throw new ForbiddenException('Read-only access');
    const c = await this.prisma.taskComment.create({
      data: { taskId, authorId: userId, body },
    });
    const mentions = await this.validMentions(
      project.workspaceId,
      body,
      mentionIds,
    );
    await this.notifyMentions(
      userId,
      task,
      project,
      mentions.map((m) => m.id),
    );
    return { id: c.id };
  }

  private async commentAccess(userId: string, commentId: string) {
    const comment = await this.prisma.taskComment.findUnique({
      where: { id: commentId },
      include: { task: { include: { project: true } } },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    const role = await this.access
      .workspaceRole(userId, comment.task.project.workspaceId)
      .catch(() => {
        throw new NotFoundException('Comment not found');
      });
    return { comment, role };
  }

  async editComment(
    userId: string,
    commentId: string,
    body: string,
    mentionIds?: string[],
  ) {
    const { comment, role } = await this.commentAccess(userId, commentId);
    // Only the author can change what they wrote.
    if (comment.authorId !== userId || !canEditTasks(role)) {
      throw new ForbiddenException('You can only edit your own comments');
    }
    if (body === comment.body) return;
    await this.prisma.taskComment.update({
      where: { id: commentId },
      data: { body, edited: true },
    });
    // Only people newly named by this edit are notified.
    const project = comment.task.project;
    const mentions = await this.validMentions(
      project.workspaceId,
      body,
      mentionIds,
    );
    const fresh = mentions.filter((m) => !comment.body.includes(`@${m.name}`));
    await this.notifyMentions(
      userId,
      comment.task,
      project,
      fresh.map((m) => m.id),
    );
  }

  async deleteComment(userId: string, commentId: string) {
    const { comment, role } = await this.commentAccess(userId, commentId);
    if (comment.authorId !== userId && !canPlan(role)) {
      throw new ForbiddenException('You can only delete your own comments');
    }
    await this.prisma.taskComment.delete({ where: { id: commentId } });
  }
}
