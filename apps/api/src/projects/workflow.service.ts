import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { StatusCategory, WorkspaceRole } from '@prisma/client';
import { AccessService, canManageSprints } from '../access/access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateStatusDto, UpdateStatusDto } from './workflow.dto.js';

const MAX_COLUMNS = 12;
const STEP = 1000;

@Injectable()
export class WorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
  ) {}

  private requireConfigure(role: WorkspaceRole) {
    if (!canManageSprints(role)) {
      throw new ForbiddenException(
        'Only owners, admins and scrum masters can configure the board',
      );
    }
  }

  private async statusAccess(userId: string, statusId: string) {
    const status = await this.prisma.workflowStatus.findUnique({
      where: { id: statusId },
      include: { project: true },
    });
    if (!status) throw new NotFoundException('Column not found');
    const role = await this.access
      .workspaceRole(userId, status.project.workspaceId)
      .catch(() => {
        throw new NotFoundException('Column not found');
      });
    return { status, project: status.project, role };
  }

  /** A board needs somewhere for work to finish and somewhere for it to start. */
  private assertShape(columns: { category: StatusCategory }[]) {
    if (!columns.some((c) => c.category === 'DONE')) {
      throw new BadRequestException('The board needs at least one Done column');
    }
    if (!columns.some((c) => c.category !== 'DONE')) {
      throw new BadRequestException(
        'The board needs at least one column that isn’t Done',
      );
    }
  }

  private async assertUniqueName(
    projectId: string,
    name: string,
    exceptId?: string,
  ) {
    const clash = await this.prisma.workflowStatus.findFirst({
      where: {
        projectId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
    if (clash)
      throw new ConflictException(`A column named “${name}” already exists`);
  }

  async create(userId: string, projectId: string, dto: CreateStatusDto) {
    const { role } = await this.access.project(userId, projectId);
    this.requireConfigure(role);
    const existing = await this.prisma.workflowStatus.findMany({
      where: { projectId },
      orderBy: { position: 'asc' },
    });
    if (existing.length >= MAX_COLUMNS) {
      throw new BadRequestException(
        `A board can have at most ${MAX_COLUMNS} columns`,
      );
    }
    await this.assertUniqueName(projectId, dto.name);

    // Work columns go before the first Done column; Done columns go last.
    const firstDone = existing.findIndex((c) => c.category === 'DONE');
    const insertAt =
      dto.category === 'DONE' || firstDone === -1 ? existing.length : firstDone;

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.workflowStatus.create({
        data: {
          projectId,
          name: dto.name,
          category: dto.category,
          wipLimit: dto.wipLimit ?? null,
          position: existing.length * STEP + STEP, // temporary, renumbered below
        },
      });
      const order = existing.map((c) => c.id);
      order.splice(insertAt, 0, created.id);
      await Promise.all(
        order.map((id, i) =>
          tx.workflowStatus.update({ where: { id }, data: { position: i } }),
        ),
      );
      return { id: created.id };
    });
  }

  async update(userId: string, statusId: string, dto: UpdateStatusDto) {
    const { status, project, role } = await this.statusAccess(userId, statusId);
    this.requireConfigure(role);
    if (dto.name && dto.name.toLowerCase() !== status.name.toLowerCase()) {
      await this.assertUniqueName(project.id, dto.name, statusId);
    }
    if (dto.category && dto.category !== status.category) {
      const all = await this.prisma.workflowStatus.findMany({
        where: { projectId: project.id },
      });
      this.assertShape(
        all.map((c) => (c.id === statusId ? { category: dto.category! } : c)),
      );
    }
    const updated = await this.prisma.workflowStatus.update({
      where: { id: statusId },
      data: {
        name: dto.name,
        category: dto.category,
        // `undefined` leaves it alone; an explicit null clears the limit.
        wipLimit: dto.wipLimit,
      },
    });
    return {
      id: updated.id,
      name: updated.name,
      category: updated.category,
      wipLimit: updated.wipLimit,
    };
  }

  async reorder(userId: string, projectId: string, ids: string[]) {
    const { role } = await this.access.project(userId, projectId);
    this.requireConfigure(role);
    const existing = await this.prisma.workflowStatus.findMany({
      where: { projectId },
      select: { id: true },
    });
    const same =
      ids.length === existing.length &&
      new Set(ids).size === ids.length &&
      existing.every((c) => ids.includes(c.id));
    if (!same)
      throw new BadRequestException(
        'Send every column of the board exactly once',
      );
    await this.prisma.$transaction(
      ids.map((id, i) =>
        this.prisma.workflowStatus.update({
          where: { id },
          data: { position: i },
        }),
      ),
    );
  }

  async remove(userId: string, statusId: string, moveToId?: string) {
    const { status, project, role } = await this.statusAccess(userId, statusId);
    this.requireConfigure(role);
    const all = await this.prisma.workflowStatus.findMany({
      where: { projectId: project.id },
    });
    this.assertShape(all.filter((c) => c.id !== statusId));

    const tasks = await this.prisma.task.findMany({
      where: { statusId },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    let target: (typeof all)[number] | undefined;
    if (tasks.length) {
      if (!moveToId) {
        throw new BadRequestException(
          `This column has ${tasks.length} task${tasks.length === 1 ? '' : 's'}. Choose a column to move them to.`,
        );
      }
      target = all.find((c) => c.id === moveToId && c.id !== statusId);
      if (!target)
        throw new BadRequestException(
          'Choose a different column of this project to move tasks to',
        );
    }

    await this.prisma.$transaction(async (tx) => {
      if (target && tasks.length) {
        const last = await tx.task.findFirst({
          where: { statusId: target.id },
          orderBy: { position: 'desc' },
          select: { position: true },
        });
        let pos = (last?.position ?? 0) + STEP;
        for (const t of tasks) {
          await tx.task.update({
            where: { id: t.id },
            data: { statusId: target.id, position: pos },
          });
          pos += STEP;
        }
        // History records the move with the categories involved.
        await tx.taskActivity.createMany({
          data: tasks.map((t) => ({
            taskId: t.id,
            actorId: userId,
            type: 'status_changed',
            data: {
              from: status.name,
              to: target!.name,
              fromCategory: status.category,
              toCategory: target!.category,
            },
          })),
        });
      }
      await tx.workflowStatus.delete({ where: { id: statusId } });
      // Close the gap in positions.
      const rest = all
        .filter((c) => c.id !== statusId)
        .sort((a, b) => a.position - b.position);
      await Promise.all(
        rest.map((c, i) =>
          tx.workflowStatus.update({
            where: { id: c.id },
            data: { position: i },
          }),
        ),
      );
    });
    return { moved: tasks.length };
  }
}
