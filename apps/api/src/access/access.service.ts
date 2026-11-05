import { Injectable, NotFoundException } from '@nestjs/common';
import type { WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Central authorisation lookups. Every failure is a 404 so callers can't tell
 * whether a resource they can't access exists.
 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  async workspaceRole(userId: string, workspaceId: string) {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
    });
    if (!member) throw new NotFoundException('Workspace not found');
    return member.role;
  }

  async project(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new NotFoundException('Project not found');
    const role = await this.workspaceRole(userId, project.workspaceId).catch(
      () => {
        throw new NotFoundException('Project not found');
      },
    );
    return { project, role };
  }

  async sprint(userId: string, sprintId: string) {
    const sprint = await this.prisma.sprint.findUnique({
      where: { id: sprintId },
      include: { project: true },
    });
    if (!sprint) throw new NotFoundException('Sprint not found');
    const role = await this.workspaceRole(
      userId,
      sprint.project.workspaceId,
    ).catch(() => {
      throw new NotFoundException('Sprint not found');
    });
    return { sprint, project: sprint.project, role };
  }

  async task(userId: string, taskId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { project: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    const role = await this.workspaceRole(
      userId,
      task.project.workspaceId,
    ).catch(() => {
      throw new NotFoundException('Task not found');
    });
    return { task, project: task.project, role };
  }
}

export const canManageProjects = (role: WorkspaceRole) =>
  role === 'OWNER' || role === 'ADMIN';

export const canEditTasks = (role: WorkspaceRole) => role !== 'VIEWER';

// Sprint lifecycle (create / start / complete).
export const canManageSprints = (role: WorkspaceRole) =>
  ['OWNER', 'ADMIN', 'SCRUM_MASTER'].includes(role);

// Backlog priority and sprint scope.
export const canPlan = (role: WorkspaceRole) =>
  ['OWNER', 'ADMIN', 'SCRUM_MASTER', 'PRODUCT_OWNER'].includes(role);
