import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma, type StatusCategory } from '@prisma/client';
import { AccessService, canManageProjects } from '../access/access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateProjectDto, UpdateProjectDto } from './projects.dto.js';

const DEFAULT_WORKFLOW: { name: string; category: StatusCategory }[] = [
  { name: 'Backlog', category: 'BACKLOG' },
  { name: 'To Do', category: 'TODO' },
  { name: 'In Progress', category: 'IN_PROGRESS' },
  { name: 'In Review', category: 'IN_REVIEW' },
  { name: 'Done', category: 'DONE' },
];

const summary = (p: {
  id: string;
  name: string;
  key: string;
  description: string;
  status: string;
}) => ({
  id: p.id,
  name: p.name,
  key: p.key,
  description: p.description,
  status: p.status,
});

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  async create(userId: string, workspaceId: string, dto: CreateProjectDto) {
    const role = await this.access.workspaceRole(userId, workspaceId);
    if (!canManageProjects(role)) {
      throw new ForbiddenException(
        'Only owners and admins can create projects',
      );
    }
    try {
      const project = await this.prisma.project.create({
        data: {
          workspaceId,
          name: dto.name,
          key: dto.key,
          description: dto.description ?? '',
          statuses: {
            create: DEFAULT_WORKFLOW.map((s, position) => ({ ...s, position })),
          },
        },
      });
      return summary(project);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(`Project key ${dto.key} is already in use`);
      }
      throw err;
    }
  }

  async list(userId: string, workspaceId: string) {
    await this.access.workspaceRole(userId, workspaceId);
    const projects = await this.prisma.project.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
    });
    return projects.map(summary);
  }

  async get(userId: string, projectId: string) {
    const { project, role } = await this.access.project(userId, projectId);
    const [statuses, repository] = await Promise.all([
      this.prisma.workflowStatus.findMany({
        where: { projectId },
        orderBy: { position: 'asc' },
        select: { id: true, name: true, category: true, wipLimit: true },
      }),
      this.prisma.gitHubRepository.findUnique({
        where: { projectId },
        select: { fullName: true },
      }),
    ]);
    return {
      ...summary(project),
      workspaceId: project.workspaceId,
      role,
      statuses,
      repository: repository?.fullName ?? null,
    };
  }

  async update(userId: string, projectId: string, dto: UpdateProjectDto) {
    const { project, role } = await this.access.project(userId, projectId);
    if (!canManageProjects(role)) {
      throw new ForbiddenException('Only owners and admins can edit projects');
    }
    const updated = await this.prisma.project.update({
      where: { id: project.id },
      data: dto,
    });
    return summary(updated);
  }

  async board(userId: string, projectId: string) {
    const { project } = await this.access.project(userId, projectId);
    const statuses = await this.prisma.workflowStatus.findMany({
      where: { projectId },
      orderBy: { position: 'asc' },
      include: {
        tasks: {
          orderBy: { position: 'asc' },
          include: {
            assignee: { select: { id: true, name: true } },
            labels: {
              select: { id: true, name: true, color: true },
              orderBy: { name: 'asc' },
            },
          },
        },
      },
    });
    return {
      project: summary(project),
      columns: statuses.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        wipLimit: s.wipLimit,
        tasks: s.tasks.map((t) => ({
          id: t.id,
          key: `${project.key}-${t.number}`,
          title: t.title,
          priority: t.priority,
          storyPoints: t.storyPoints,
          blocked: t.blocked,
          position: t.position,
          assignee: t.assignee,
          labels: t.labels,
        })),
      })),
    };
  }
}
