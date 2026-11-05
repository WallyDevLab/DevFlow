import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
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
import type { CreateTaskDto, UpdateTaskDto } from './projects.dto.js';

const STEP = 1000; // gap between positions so reordering rarely needs renumbering

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly notifications: NotificationsService,
  ) {}

  private async assertAssignable(workspaceId: string, assigneeId: string) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: assigneeId, workspaceId } },
    });
    if (!member) {
      throw new BadRequestException('Assignee must be a workspace member');
    }
  }

  private async assertStatus(projectId: string, statusId: string) {
    const status = await this.prisma.workflowStatus.findFirst({
      where: { id: statusId, projectId },
    });
    if (!status)
      throw new BadRequestException('Unknown status for this project');
    return status;
  }

  private async lastPosition(tx: Prisma.TransactionClient, statusId: string) {
    const last = await tx.task.findFirst({
      where: { statusId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return (last?.position ?? 0) + STEP;
  }

  private async lastBacklogRank(
    tx: Prisma.TransactionClient,
    projectId: string,
  ) {
    const last = await tx.task.findFirst({
      where: { projectId },
      orderBy: { backlogRank: 'desc' },
      select: { backlogRank: true },
    });
    return (last?.backlogRank ?? 0) + STEP;
  }

  async create(userId: string, projectId: string, dto: CreateTaskDto) {
    const { project, role } = await this.access.project(userId, projectId);
    if (!canEditTasks(role)) throw new ForbiddenException('Read-only access');
    if (project.status === 'ARCHIVED') {
      throw new BadRequestException('This project is archived');
    }
    if (dto.assigneeId)
      await this.assertAssignable(project.workspaceId, dto.assigneeId);

    const status = dto.statusId
      ? await this.assertStatus(projectId, dto.statusId)
      : await this.prisma.workflowStatus.findFirstOrThrow({
          where: { projectId },
          orderBy: { position: 'asc' },
        });

    const created = await this.prisma.$transaction(async (tx) => {
      // Atomic increment keeps task numbers unique within the project.
      const { nextTaskNumber } = await tx.project.update({
        where: { id: projectId },
        data: { nextTaskNumber: { increment: 1 } },
        select: { nextTaskNumber: true },
      });
      const number = nextTaskNumber - 1;
      const task = await tx.task.create({
        data: {
          projectId,
          number,
          title: dto.title,
          description: dto.description ?? '',
          statusId: status.id,
          priority: dto.priority ?? 'MEDIUM',
          assigneeId: dto.assigneeId,
          reporterId: userId,
          storyPoints: dto.storyPoints,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          position: await this.lastPosition(tx, status.id),
          backlogRank: await this.lastBacklogRank(tx, projectId),
        },
      });
      await tx.taskActivity.create({
        data: {
          taskId: task.id,
          actorId: userId,
          type: 'created',
          data: { status: status.name, category: status.category },
        },
      });
      return { id: task.id, key: `${project.key}-${number}` };
    });
    if (dto.assigneeId) {
      const actor = await this.notifications.nameOf(userId);
      await this.notifications.notify({
        type: 'TASK_ASSIGNED',
        recipients: [dto.assigneeId],
        actorId: userId,
        workspaceId: project.workspaceId,
        message: `${actor} assigned you ${taskLabel(created.key, dto.title)}`,
        link: `/tasks/${created.id}`,
      });
    }
    return created;
  }

  async get(userId: string, taskId: string) {
    const { task, project, role } = await this.access.task(userId, taskId);
    const [full, activity, statuses, pullRequests] = await Promise.all([
      this.prisma.task.findUniqueOrThrow({
        where: { id: taskId },
        include: {
          status: true,
          assignee: { select: { id: true, name: true } },
          reporter: { select: { id: true, name: true } },
          labels: {
            select: { id: true, name: true, color: true },
            orderBy: { name: 'asc' },
          },
        },
      }),
      this.prisma.taskActivity.findMany({
        where: { taskId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.workflowStatus.findMany({
        where: { projectId: project.id },
        orderBy: { position: 'asc' },
        select: { id: true, name: true },
      }),
      this.prisma.pullRequest.findMany({
        where: { taskId },
        orderBy: { openedAt: 'desc' },
        include: { repository: { select: { fullName: true } } },
      }),
    ]);
    const actors = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(activity.map((a) => a.actorId))] } },
      select: { id: true, name: true },
    });
    const names = new Map(actors.map((u) => [u.id, u.name]));
    return {
      id: full.id,
      key: `${project.key}-${task.number}`,
      projectId: project.id,
      projectName: project.name,
      workspaceId: project.workspaceId,
      title: full.title,
      description: full.description,
      status: { id: full.status.id, name: full.status.name },
      statuses,
      priority: full.priority,
      labels: full.labels,
      assignee: full.assignee,
      reporter: full.reporter,
      storyPoints: full.storyPoints,
      dueDate: full.dueDate,
      blocked: full.blocked,
      blockedReason: full.blockedReason,
      createdAt: full.createdAt,
      updatedAt: full.updatedAt,
      canEdit: canEditTasks(role),
      pullRequests: pullRequests.map((pr) => ({
        id: pr.id,
        repository: pr.repository.fullName,
        number: pr.number,
        title: pr.title,
        url: pr.url,
        state: pr.state,
        draft: pr.draft,
        merged: pr.merged,
        branch: pr.headBranch,
        author: pr.author,
        reviewState: pr.reviewState,
        checksState: pr.checksState,
      })),
      activity: activity.map((a) => ({
        id: a.id,
        type: a.type,
        data: a.data,
        actor:
          a.actorId === 'github'
            ? 'GitHub'
            : (names.get(a.actorId) ?? 'Unknown'),
        createdAt: a.createdAt,
      })),
    };
  }

  async update(userId: string, taskId: string, dto: UpdateTaskDto) {
    const { task, project, role } = await this.access.task(userId, taskId);
    if (!canEditTasks(role)) throw new ForbiddenException('Read-only access');

    const data: Prisma.TaskUncheckedUpdateInput = {};
    const events: { type: string; data?: Prisma.InputJsonValue }[] = [];
    const changed: string[] = [];

    if (dto.title !== undefined && dto.title !== task.title) {
      data.title = dto.title;
      changed.push('title');
    }
    if (dto.description !== undefined && dto.description !== task.description) {
      data.description = dto.description;
      changed.push('description');
    }
    if (dto.priority !== undefined && dto.priority !== task.priority) {
      data.priority = dto.priority;
      events.push({
        type: 'priority_changed',
        data: { from: task.priority, to: dto.priority },
      });
    }
    if (dto.storyPoints !== undefined && dto.storyPoints !== task.storyPoints) {
      data.storyPoints = dto.storyPoints;
      changed.push('story points');
    }
    if (dto.dueDate !== undefined) {
      data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
      changed.push('due date');
    }
    if (dto.assigneeId !== undefined && dto.assigneeId !== task.assigneeId) {
      if (dto.assigneeId) {
        await this.assertAssignable(project.workspaceId, dto.assigneeId);
      }
      data.assigneeId = dto.assigneeId;
      events.push({
        type: 'assigned',
        data: { from: task.assigneeId, to: dto.assigneeId },
      });
    }
    if (dto.blocked !== undefined && dto.blocked !== task.blocked) {
      data.blocked = dto.blocked;
      data.blockedReason = dto.blocked ? (dto.blockedReason ?? null) : null;
      events.push({
        type: dto.blocked ? 'blocked' : 'unblocked',
        data: dto.blocked ? { reason: dto.blockedReason ?? null } : undefined,
      });
    }

    if (dto.sprintId !== undefined || dto.backlogRank !== undefined) {
      if (!canPlan(role)) {
        throw new ForbiddenException(
          'Only owners, admins, scrum masters and product owners can plan sprints',
        );
      }
    }
    if (dto.backlogRank !== undefined) data.backlogRank = dto.backlogRank;

    // Scope changes on an ACTIVE sprint are recorded so the sprint report can
    // separate the original commitment from work added or removed later.
    const scope: { sprintId: string; type: 'ADDED' | 'REMOVED' }[] = [];
    if (dto.sprintId !== undefined && dto.sprintId !== task.sprintId) {
      const [from, to] = await Promise.all([
        task.sprintId
          ? this.prisma.sprint.findUnique({ where: { id: task.sprintId } })
          : null,
        dto.sprintId
          ? this.prisma.sprint.findFirst({
              where: { id: dto.sprintId, projectId: project.id },
            })
          : null,
      ]);
      if (dto.sprintId && !to) {
        throw new BadRequestException('Unknown sprint for this project');
      }
      if (to?.status === 'COMPLETED' || from?.status === 'COMPLETED') {
        throw new BadRequestException('Completed sprints can’t change');
      }
      data.sprintId = dto.sprintId;
      events.push({
        type: 'sprint_changed',
        data: { from: from?.name ?? null, to: to?.name ?? null },
      });
      if (from?.status === 'ACTIVE') {
        scope.push({ sprintId: from.id, type: 'REMOVED' });
      }
      if (to?.status === 'ACTIVE') {
        scope.push({ sprintId: to.id, type: 'ADDED' });
      }
    }

    let labelChange: { ids: string[] } | null = null;
    if (dto.labelIds !== undefined) {
      const ids = [...new Set(dto.labelIds)];
      const [wanted, current] = await Promise.all([
        this.prisma.label.findMany({
          where: { id: { in: ids }, projectId: project.id },
        }),
        this.prisma.label.findMany({
          where: { tasks: { some: { id: taskId } } },
        }),
      ]);
      if (wanted.length !== ids.length) {
        throw new BadRequestException('Unknown label for this project');
      }
      const have = new Set(current.map((l) => l.id));
      const want = new Set(ids);
      const added = wanted.filter((l) => !have.has(l.id)).map((l) => l.name);
      const removed = current.filter((l) => !want.has(l.id)).map((l) => l.name);
      if (added.length || removed.length) {
        labelChange = { ids };
        events.push({ type: 'labels_changed', data: { added, removed } });
      }
    }

    let moveTo: { id: string; name: string; category: string } | null = null;
    if (dto.statusId !== undefined && dto.statusId !== task.statusId) {
      moveTo = await this.assertStatus(project.id, dto.statusId);
      data.statusId = moveTo.id;
    }
    if (changed.length)
      events.push({ type: 'updated', data: { fields: changed } });

    await this.prisma.$transaction(async (tx) => {
      if (moveTo) {
        const from = await tx.workflowStatus.findUniqueOrThrow({
          where: { id: task.statusId },
        });
        events.push({
          type: 'status_changed',
          data: {
            from: from.name,
            to: moveTo.name,
            // Categories are stored with the event so history keeps its meaning
            // if a column is later renamed or re-categorised.
            fromCategory: from.category,
            toCategory: moveTo.category,
          },
        });
      }
      if (dto.position !== undefined) {
        data.position = dto.position;
      } else if (moveTo) {
        data.position = await this.lastPosition(tx, moveTo.id);
      }
      if (Object.keys(data).length) {
        await tx.task.update({ where: { id: taskId }, data });
      }
      if (labelChange) {
        await tx.task.update({
          where: { id: taskId },
          data: { labels: { set: labelChange.ids.map((id) => ({ id })) } },
        });
      }
      if (scope.length) {
        await tx.sprintEvent.createMany({
          data: scope.map((s) => ({
            sprintId: s.sprintId,
            taskId,
            type: s.type,
            points: task.storyPoints ?? 0,
            data: { key: `${project.key}-${task.number}`, title: task.title },
          })),
        });
      }
      if (events.length) {
        await tx.taskActivity.createMany({
          data: events.map((e) => ({
            taskId,
            actorId: userId,
            type: e.type,
            data: e.data,
          })),
        });
      }
    });

    // Notify after the change is saved; failures never undo the update.
    const assignedNow =
      events.some((e) => e.type === 'assigned') && dto.assigneeId;
    const blockedNow = events.some((e) => e.type === 'blocked');
    if (assignedNow || blockedNow) {
      const actor = await this.notifications.nameOf(userId);
      const label = taskLabel(
        `${project.key}-${task.number}`,
        dto.title ?? task.title,
      );
      const link = `/tasks/${taskId}`;
      if (assignedNow) {
        await this.notifications.notify({
          type: 'TASK_ASSIGNED',
          recipients: [dto.assigneeId],
          actorId: userId,
          workspaceId: project.workspaceId,
          message: `${actor} assigned you ${label}`,
          link,
        });
      }
      if (blockedNow) {
        const reason = dto.blockedReason ? `: ${dto.blockedReason}` : '';
        await this.notifications.notify({
          type: 'TASK_BLOCKED',
          recipients: [
            dto.assigneeId !== undefined ? dto.assigneeId : task.assigneeId,
            task.reporterId,
          ],
          actorId: userId,
          workspaceId: project.workspaceId,
          message: `${actor} marked ${label} as blocked${reason}`,
          link,
        });
      }
    }
  }

  async remove(userId: string, taskId: string) {
    const { task, role } = await this.access.task(userId, taskId);
    const privileged = ['OWNER', 'ADMIN', 'SCRUM_MASTER', 'PRODUCT_OWNER'];
    if (!privileged.includes(role) && task.reporterId !== userId) {
      throw new ForbiddenException('You can only delete tasks you created');
    }
    await this.prisma.task.delete({ where: { id: taskId } });
  }
}
