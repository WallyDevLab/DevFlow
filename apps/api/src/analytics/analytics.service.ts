import { BadRequestException, Injectable } from '@nestjs/common';
import { AccessService } from '../access/access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  computeAnalytics,
  type Category,
  type Definition,
  type SprintInput,
  type TaskInput,
} from './analytics.calc.js';

const DAY = 86_400_000;
const DEFAULT_RANGE_DAYS = 90;
const MAX_RANGE_DAYS = 366;

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async forProject(
    userId: string,
    projectId: string,
    query: { from?: string; to?: string; definition?: Definition },
  ) {
    const { project } = await this.access.project(userId, projectId);

    const now = new Date();
    const to = query.to ? endOfDay(new Date(query.to)) : now;
    const from = query.from
      ? new Date(query.from)
      : new Date(+to - DEFAULT_RANGE_DAYS * DAY);
    if (+from >= +to)
      throw new BadRequestException('"from" must be before "to"');
    if (+to - +from > MAX_RANGE_DAYS * DAY) {
      throw new BadRequestException(
        `Choose a range of at most ${MAX_RANGE_DAYS} days`,
      );
    }

    const [statuses, tasks, sprints, pullRequests] = await Promise.all([
      this.prisma.workflowStatus.findMany({
        where: { projectId },
        orderBy: { position: 'asc' },
        select: { name: true, category: true },
      }),
      this.prisma.task.findMany({
        where: { projectId },
        include: {
          status: { select: { name: true, category: true } },
          activity: { select: { type: true, data: true, createdAt: true } },
          pullRequests: { select: { mergedAt: true } },
        },
      }),
      this.prisma.sprint.findMany({
        where: { projectId, status: 'COMPLETED', completedAt: { not: null } },
        include: { events: true },
      }),
      this.prisma.pullRequest.findMany({
        where: { repository: { projectId } },
        select: { openedAt: true, mergedAt: true },
      }),
    ]);

    const taskInputs: TaskInput[] = tasks.map((t) => {
      const created = t.activity.find((a) => a.type === 'created');
      const merges = t.pullRequests
        .map((p) => p.mergedAt)
        .filter((d): d is Date => d !== null)
        .sort((a, b) => +a - +b);
      return {
        id: t.id,
        key: `${project.key}-${t.number}`,
        title: t.title,
        createdAt: t.createdAt,
        createdStatus:
          ((created?.data as { status?: string } | null)?.status as string) ??
          null,
        createdCategory:
          ((created?.data as { category?: Category } | null)
            ?.category as Category) ?? null,
        currentStatus: t.status.name,
        currentCategory: t.status.category as Category,
        blocked: t.blocked,
        blockedReason: t.blockedReason,
        events: t.activity.map((a) => ({
          type: a.type,
          data: a.data as Record<string, unknown> | null,
          at: a.createdAt,
        })),
        mergedAt: merges[0] ?? null,
      };
    });

    const sprintInputs: SprintInput[] = sprints.map((s) => {
      const sum = (type: string) =>
        s.events
          .filter((e) => e.type === type)
          .reduce((n, e) => n + e.points, 0);
      const committedIds = new Set(
        s.events.filter((e) => e.type === 'COMMITTED').map((e) => e.taskId),
      );
      return {
        id: s.id,
        name: s.name,
        completedAt: s.completedAt!,
        committedPoints: sum('COMMITTED'),
        completedCommittedPoints: s.events
          .filter((e) => e.type === 'COMPLETED' && committedIds.has(e.taskId))
          .reduce((n, e) => n + e.points, 0),
        addedPoints: sum('ADDED'),
        removedPoints: sum('REMOVED'),
      };
    });

    return {
      project: { id: project.id, name: project.name, key: project.key },
      hasRepository:
        (await this.prisma.gitHubRepository.count({ where: { projectId } })) >
        0,
      ...computeAnalytics({
        tasks: taskInputs,
        statuses: statuses.map((s) => ({
          name: s.name,
          category: s.category as Category,
        })),
        sprints: sprintInputs,
        pullRequests,
        from,
        to,
        definition: query.definition ?? 'done',
        now,
      }),
    };
  }
}

// A date-only "to" should include that whole day.
function endOfDay(d: Date) {
  return new Date(+d + DAY - 1);
}
