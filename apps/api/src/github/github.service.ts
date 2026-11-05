import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AccessService, canManageProjects } from '../access/access.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { GitHubApiService } from './github-api.service.js';

const STATE_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class GitHubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly api: GitHubApiService,
    private readonly config: ConfigService,
  ) {}

  // The state value ties the GitHub round-trip to one user and workspace. It
  // uses its own HMAC key (not the JWT secret) so it can never be mistaken for
  // an access token.
  private stateKey() {
    return createHash('sha256')
      .update(`github-state:${this.config.getOrThrow<string>('JWT_SECRET')}`)
      .digest();
  }

  private signState(workspaceId: string, userId: string) {
    const payload = Buffer.from(
      JSON.stringify({
        w: workspaceId,
        u: userId,
        e: Date.now() + STATE_TTL_MS,
      }),
    ).toString('base64url');
    const sig = createHmac('sha256', this.stateKey())
      .update(payload)
      .digest('base64url');
    return `${payload}.${sig}`;
  }

  private readState(state: string): { w: string; u: string } {
    const [payload, sig] = state.split('.');
    const bad = new BadRequestException(
      'This connection request is invalid or has expired',
    );
    if (!payload || !sig) throw bad;
    const expected = createHmac('sha256', this.stateKey())
      .update(payload)
      .digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      throw bad;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
        w: string;
        u: string;
        e: number;
      };
      if (data.e < Date.now()) throw bad;
      return data;
    } catch {
      throw bad;
    }
  }

  private async requireManager(userId: string, workspaceId: string) {
    const role = await this.access.workspaceRole(userId, workspaceId);
    if (!canManageProjects(role)) {
      throw new ForbiddenException(
        'Only owners and admins can manage integrations',
      );
    }
  }

  private async installationFor(workspaceId: string) {
    const installation = await this.prisma.gitHubInstallation.findUnique({
      where: { workspaceId },
    });
    if (!installation) throw new NotFoundException('GitHub is not connected');
    return installation;
  }

  async status(userId: string, workspaceId: string) {
    const role = await this.access.workspaceRole(userId, workspaceId);
    const manager = canManageProjects(role);
    const installation = await this.prisma.gitHubInstallation.findUnique({
      where: { workspaceId },
    });
    return {
      configured: this.api.configured,
      canManage: manager,
      installation: installation
        ? {
            accountLogin: installation.accountLogin,
            accountType: installation.accountType,
          }
        : null,
      installUrl:
        manager && this.api.configured && !installation
          ? `${this.api.webUrl}/apps/${this.api.slug}/installations/new?state=${encodeURIComponent(
              this.signState(workspaceId, userId),
            )}`
          : null,
    };
  }

  /** Completes the install: called by the web app after GitHub redirects back. */
  async completeInstall(
    userId: string,
    input: { installationId: number; code: string; state: string },
  ) {
    if (!this.api.configured) {
      throw new ServiceUnavailableException(
        'GitHub integration is not configured',
      );
    }
    const state = this.readState(input.state);
    if (state.u !== userId)
      throw new ForbiddenException('This request belongs to another user');
    await this.requireManager(userId, state.w);

    // Prove the signed-in GitHub user can actually see this installation.
    // Without this, anyone could attach an installation id they don't own and
    // read that organisation's repositories through our app credentials.
    const userToken = await this.api.exchangeCode(input.code);
    if (!userToken)
      throw new ForbiddenException('GitHub did not authorise this request');
    const visible = await this.api.userInstallationIds(userToken);
    if (!visible.includes(input.installationId)) {
      throw new ForbiddenException(
        'That installation isn’t available to your GitHub account',
      );
    }

    const info = await this.api.getInstallation(input.installationId);
    try {
      await this.prisma.gitHubInstallation.upsert({
        where: { workspaceId: state.w },
        create: {
          workspaceId: state.w,
          installationId: input.installationId,
          accountLogin: info.account.login,
          accountType: info.account.type,
          connectedById: userId,
        },
        update: {
          installationId: input.installationId,
          accountLogin: info.account.login,
          accountType: info.account.type,
          connectedById: userId,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'That GitHub installation is already connected to another workspace',
        );
      }
      throw err;
    }
    await this.prisma.auditLog.create({
      data: {
        workspaceId: state.w,
        actorId: userId,
        action: 'github.connected',
        metadata: { account: info.account.login },
      },
    });
    return { workspaceId: state.w, accountLogin: info.account.login };
  }

  async disconnect(userId: string, workspaceId: string) {
    await this.requireManager(userId, workspaceId);
    const installation = await this.installationFor(workspaceId);
    // Revoke on GitHub first so access really ends; still disconnect locally
    // if GitHub can't be reached, and tell the caller.
    let revoked = true;
    try {
      await this.api.uninstall(installation.installationId);
    } catch {
      revoked = false;
    }
    await this.prisma.gitHubInstallation.delete({
      where: { id: installation.id },
    });
    await this.prisma.auditLog.create({
      data: {
        workspaceId,
        actorId: userId,
        action: 'github.disconnected',
        metadata: {
          account: installation.accountLogin,
          revokedOnGitHub: String(revoked),
        },
      },
    });
    return { revokedOnGitHub: revoked };
  }

  async listRepositories(userId: string, workspaceId: string) {
    await this.requireManager(userId, workspaceId);
    const installation = await this.installationFor(workspaceId);
    const [repos, linked] = await Promise.all([
      this.api.listRepositories(installation.installationId),
      this.prisma.gitHubRepository.findMany({
        where: { installationId: installation.id },
        select: { githubId: true, projectId: true },
      }),
    ]);
    const byId = new Map(linked.map((l) => [Number(l.githubId), l.projectId]));
    return repos.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      private: r.private,
      linkedProjectId: byId.get(r.id) ?? null,
    }));
  }

  async linkRepository(userId: string, projectId: string, fullName: string) {
    const { project, role } = await this.access.project(userId, projectId);
    if (!canManageProjects(role)) {
      throw new ForbiddenException(
        'Only owners and admins can link repositories',
      );
    }
    const installation = await this.installationFor(project.workspaceId);
    // Only repositories the installation can actually access may be linked.
    const repos = await this.api.listRepositories(installation.installationId);
    const repo = repos.find(
      (r) => r.full_name.toLowerCase() === fullName.toLowerCase(),
    );
    if (!repo)
      throw new BadRequestException(
        'That repository isn’t accessible to the GitHub app',
      );
    try {
      await this.prisma.$transaction([
        this.prisma.gitHubRepository.deleteMany({ where: { projectId } }),
        this.prisma.gitHubRepository.create({
          data: {
            installationId: installation.id,
            githubId: repo.id,
            fullName: repo.full_name,
            projectId,
          },
        }),
      ]);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'That repository is already linked to another project',
        );
      }
      throw err;
    }
    return { fullName: repo.full_name };
  }

  async unlinkRepository(userId: string, projectId: string) {
    const { role } = await this.access.project(userId, projectId);
    if (!canManageProjects(role)) {
      throw new ForbiddenException(
        'Only owners and admins can unlink repositories',
      );
    }
    await this.prisma.gitHubRepository.deleteMany({ where: { projectId } });
  }
}
