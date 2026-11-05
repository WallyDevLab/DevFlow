import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma, type SprintEvent } from '@prisma/client';
import {
  AccessService,
  canManageSprints,
  canPlan,
} from '../access/access.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CompleteSprintDto,
  CreateSprintDto,
  UpdateSprintDto,
} from './sprints.dto.js';

type TaskRow = Prisma.TaskGetPayload<{
  include: {
    status: true;
    assignee: { select: { id: true; name: true } };
    labels: { select: { id: true; name: true; color: true } };
  };
}>;

const points = (t: { storyPoints: number | null }) => t.storyPoints ?? 0;

@Injectable()
export class SprintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly notifications: NotificationsService,
  ) {}

  private assertDates(start: Date, end: Date) {
    if (Number.isNaN(+start) || Number.isNaN(+end) || start >= end) {
      throw new BadRequestException('Start date must be before the end date');
    }
  }

  private requireManage(role: Parameters<typeof canManageSprints>[0]) {
    if (!canManageSprints(role)) {
      throw new ForbiddenException(
        'Only owners, admins and scrum masters can manage sprints',
      );
    }
  }

  // ---- Backlog -----------------------------------------------------------

  async backlog(userId: string, projectId: string) {
    const { project, role } = await this.access.project(userId, projectId);
    const include = {
      status: true,
      assignee: { select: { id: true, name: true } },
      labels: { select: { id: true, name: true, color: true } },
    } as const;

    const [sprints, backlog, completed] = await Promise.all([
      this.prisma.sprint.findMany({
        where: { projectId, status: { in: ['PLANNING', 'ACTIVE'] } },
        orderBy: [{ status: 'asc' }, { startDate: 'asc' }],
        include: { tasks: { include, orderBy: { backlogRank: 'asc' } } },
      }),
      this.prisma.task.findMany({
        where: {
          projectId,
          sprintId: null,
          status: { category: { not: 'DONE' } },
        },
        include,
        orderBy: { backlogRank: 'asc' },
      }),
      this.prisma.sprint.findMany({
        where: { projectId, status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
        take: 10,
        select: { id: true, name: true, completedAt: true },
      }),
    ]);

    const view = (t: TaskRow) => ({
      id: t.id,
      key: `${project.key}-${t.number}`,
      title: t.title,
      priority: t.priority,
      storyPoints: t.storyPoints,
      blocked: t.blocked,
      backlogRank: t.backlogRank,
      status: { name: t.status.name, category: t.status.category },
      assignee: t.assignee,
      labels: t.labels,
    });

    return {
      project: { id: project.id, name: project.name, key: project.key },
      permissions: {
        planBacklog: canPlan(role),
        manageSprints: canManageSprints(role),
      },
      sprints: sprints.map((s) => ({
        id: s.id,
        name: s.name,
        goal: s.goal,
        startDate: s.startDate,
        endDate: s.endDate,
        status: s.status,
        points: s.tasks.reduce((n, t) => n + points(t), 0),
        tasks: s.tasks.map(view),
      })),
      backlog: backlog.map(view),
      completed,
    };
  }

  // ---- Sprint lifecycle --------------------------------------------------

  async create(userId: string, projectId: string, dto: CreateSprintDto) {
    const { project, role } = await this.access.project(userId, projectId);
    this.requireManage(role);
    if (project.status === 'ARCHIVED') {
      throw new BadRequestException('This project is archived');
    }
    const start = new Date(dto.startDate);
    const end = new Date(dto.endDate);
    this.assertDates(start, end);
    const sprint = await this.prisma.sprint.create({
      data: {
        projectId,
        name: dto.name,
        goal: dto.goal ?? '',
        startDate: start,
        endDate: end,
      },
    });
    return { id: sprint.id };
  }

  async update(userId: string, sprintId: string, dto: UpdateSprintDto) {
    const { sprint, role } = await this.access.sprint(userId, sprintId);
    this.requireManage(role);
    if (sprint.status === 'COMPLETED') {
      throw new BadRequestException('Completed sprints can’t be edited');
    }
    const start = dto.startDate ? new Date(dto.startDate) : sprint.startDate;
    const end = dto.endDate ? new Date(dto.endDate) : sprint.endDate;
    this.assertDates(start, end);
    await this.prisma.sprint.update({
      where: { id: sprintId },
      data: { name: dto.name, goal: dto.goal, startDate: start, endDate: end },
    });
  }

  async start(userId: string, sprintId: string) {
    const { sprint, project, role } = await this.access.sprint(
      userId,
      sprintId,
    );
    this.requireManage(role);
    if (sprint.status !== 'PLANNING') {
      throw new BadRequestException('Only a planned sprint can be started');
    }
    const active = await this.prisma.sprint.findFirst({
      where: { projectId: sprint.projectId, status: 'ACTIVE' },
    });
    if (active) {
      throw new ConflictException(
        `“${active.name}” is already active. Complete it before starting another sprint.`,
      );
    }
    let assignees: (string | null)[] = [];
    try {
      assignees = await this.prisma.$transaction(async (tx) => {
        const tasks = await tx.task.findMany({
          where: { sprintId },
          include: { project: { select: { key: true } } },
        });
        await tx.sprint.update({
          where: { id: sprintId },
          data: { status: 'ACTIVE', startedAt: new Date() },
        });
        // Snapshot of the original commitment; later scope changes are
        // recorded as separate ADDED / REMOVED events.
        await tx.sprintEvent.createMany({
          data: tasks.map((t) => ({
            sprintId,
            taskId: t.id,
            type: 'COMMITTED' as const,
            points: points(t),
            data: { key: `${t.project.key}-${t.number}`, title: t.title },
          })),
        });
        return tasks.map((t) => t.assigneeId);
      });
    } catch (err) {
      // The partial unique index catches two sprints being started at once.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Another sprint is already active');
      }
      throw err;
    }
    await this.notifications.notify({
      type: 'SPRINT_STARTED',
      recipients: assignees,
      actorId: userId,
      workspaceId: project.workspaceId,
      message: `${await this.notifications.nameOf(userId)} started sprint “${sprint.name}”, which includes tasks assigned to you`,
      link: `/projects/${project.id}/backlog`,
    });
  }

  async complete(userId: string, sprintId: string, dto: CompleteSprintDto) {
    const { sprint, project, role } = await this.access.sprint(
      userId,
      sprintId,
    );
    this.requireManage(role);
    if (sprint.status !== 'ACTIVE') {
      throw new BadRequestException('Only an active sprint can be completed');
    }

    let targetId: string | null = null;
    if (dto.incompleteTo !== 'BACKLOG') {
      const target = await this.prisma.sprint.findFirst({
        where: {
          id: dto.incompleteTo,
          projectId: project.id,
          status: 'PLANNING',
        },
      });
      if (!target) {
        throw new BadRequestException(
          'Incomplete work can only move to the backlog or a sprint that is still being planned',
        );
      }
      targetId = target.id;
    }

    const assignees = await this.prisma.$transaction(async (tx) => {
      const tasks = await tx.task.findMany({
        where: { sprintId },
        include: { status: true },
      });
      const done = tasks.filter((t) => t.status.category === 'DONE');
      const open = tasks.filter((t) => t.status.category !== 'DONE');
      const info = (t: (typeof tasks)[number]) => ({
        key: `${project.key}-${t.number}`,
        title: t.title,
      });

      await tx.sprintEvent.createMany({
        data: [
          ...done.map((t) => ({
            sprintId,
            taskId: t.id,
            type: 'COMPLETED' as const,
            points: points(t),
            data: info(t),
          })),
          ...open.map((t) => ({
            sprintId,
            taskId: t.id,
            type: 'CARRIED_OVER' as const,
            points: points(t),
            data: { ...info(t), to: targetId ?? 'BACKLOG' },
          })),
        ],
      });
      if (open.length) {
        await tx.task.updateMany({
          where: { id: { in: open.map((t) => t.id) } },
          data: { sprintId: targetId },
        });
        await tx.taskActivity.createMany({
          data: open.map((t) => ({
            taskId: t.id,
            actorId: userId,
            type: 'sprint_changed',
            data: { from: sprint.name, to: targetId ? 'next sprint' : null },
          })),
        });
      }
      await tx.sprint.update({
        where: { id: sprintId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      return tasks.map((t) => t.assigneeId);
    });
    await this.notifications.notify({
      type: 'SPRINT_COMPLETED',
      recipients: assignees,
      actorId: userId,
      workspaceId: project.workspaceId,
      message: `${await this.notifications.nameOf(userId)} completed sprint “${sprint.name}”. See the report.`,
      link: `/sprints/${sprintId}/report`,
    });
  }

  // ---- Report ------------------------------------------------------------

  async report(userId: string, sprintId: string) {
    const { sprint, project } = await this.access.sprint(userId, sprintId);
    const events = await this.prisma.sprintEvent.findMany({
      where: { sprintId },
      orderBy: { createdAt: 'asc' },
    });
    const item = (e: Pick<SprintEvent, 'taskId' | 'points' | 'data'>) => {
      const d = (e.data ?? {}) as { key?: string; title?: string };
      return {
        taskId: e.taskId,
        key: d.key ?? '—',
        title: d.title ?? 'Deleted task',
        points: e.points,
      };
    };
    const of = (type: SprintEvent['type']) =>
      events.filter((e) => e.type === type).map(item);
    const sum = (xs: { points: number }[]) =>
      xs.reduce((n, x) => n + x.points, 0);

    const committed = of('COMMITTED');
    const added = of('ADDED');
    const removed = of('REMOVED');

    let completed: ReturnType<typeof item>[];
    let carriedOver: ReturnType<typeof item>[];
    if (sprint.status === 'COMPLETED') {
      completed = of('COMPLETED');
      carriedOver = of('CARRIED_OVER');
    } else {
      // Live view while the sprint is still running.
      const tasks = await this.prisma.task.findMany({
        where: { sprintId },
        include: { status: true },
      });
      const row = (t: (typeof tasks)[number]) => ({
        taskId: t.id,
        key: `${project.key}-${t.number}`,
        title: t.title,
        points: points(t),
      });
      completed = tasks.filter((t) => t.status.category === 'DONE').map(row);
      carriedOver = tasks.filter((t) => t.status.category !== 'DONE').map(row);
    }

    const committedIds = new Set(committed.map((c) => c.taskId));
    const committedPoints = sum(committed);
    const completedCommittedPoints = sum(
      completed.filter((c) => committedIds.has(c.taskId)),
    );

    return {
      sprint: {
        id: sprint.id,
        name: sprint.name,
        goal: sprint.goal,
        status: sprint.status,
        startDate: sprint.startDate,
        endDate: sprint.endDate,
        startedAt: sprint.startedAt,
        completedAt: sprint.completedAt,
      },
      project: { id: project.id, name: project.name },
      final: sprint.status === 'COMPLETED',
      committedPoints,
      completedPoints: sum(completed),
      completedCommittedPoints,
      addedPoints: sum(added),
      removedPoints: sum(removed),
      // Completed committed points ÷ committed points × 100.
      completionRate: committedPoints
        ? Math.round((completedCommittedPoints / committedPoints) * 100)
        : null,
      committed,
      added,
      removed,
      completed,
      incomplete: carriedOver,
    };
  }
}
