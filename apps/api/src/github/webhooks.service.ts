import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  NotificationsService,
  taskLabel,
} from '../notifications/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { GitHubApiService } from './github-api.service.js';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const STALE_RECEIVED_MS = 5 * 60 * 1000;

/**
 * Links from webhook payloads end up as clickable hrefs in the UI. Only
 * https URLs are kept, so a crafted payload can never store a javascript: or
 * data: link.
 */
export function safeHttpsUrl(value: unknown): string {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' ? url.toString() : 'https://github.com';
  } catch {
    return 'https://github.com';
  }
}

@Injectable()
export class WebhooksService {
  private readonly log = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: GitHubApiService,
    private readonly notifications: NotificationsService,
  ) {}

  verifySignature(raw: Buffer, signature: string | undefined) {
    const secret = this.api.webhookSecret;
    if (!secret || !signature) return false;
    const expected = Buffer.from(
      `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`,
    );
    const given = Buffer.from(signature);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  /**
   * Records the delivery and processes it in the background so the response
   * to GitHub is immediate. Delivery ids make this idempotent.
   */
  async ingest(deliveryId: string, event: string, payload: Json) {
    const action = typeof payload.action === 'string' ? payload.action : null;
    try {
      await this.prisma.webhookEvent.create({
        data: { deliveryId, event, action },
      });
    } catch (err) {
      if (!(
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      )) {
        throw err;
      }
      const existing = await this.prisma.webhookEvent.findUniqueOrThrow({
        where: { deliveryId },
      });
      // Redeliveries of handled events are acknowledged and ignored. Failed or
      // abandoned ones are retried.
      const retry =
        existing.status === 'FAILED' ||
        (existing.status === 'RECEIVED' &&
          Date.now() - existing.receivedAt.getTime() > STALE_RECEIVED_MS);
      if (!retry) return { duplicate: true };
    }
    void this.process(deliveryId, event, payload);
    return { duplicate: false };
  }

  private async process(deliveryId: string, event: string, payload: Json) {
    try {
      const handled = await this.dispatch(event, payload);
      await this.prisma.webhookEvent.update({
        where: { deliveryId },
        data: {
          status: handled ? 'PROCESSED' : 'IGNORED',
          processedAt: new Date(),
          error: null,
        },
      });
    } catch (err) {
      this.log.error(
        `Webhook ${deliveryId} (${event}) failed: ${(err as Error).message}`,
      );
      await this.prisma.webhookEvent
        .update({
          where: { deliveryId },
          data: {
            status: 'FAILED',
            error: (err as Error).message.slice(0, 500),
          },
        })
        .catch(() => undefined);
    }
  }

  private dispatch(event: string, p: Json): Promise<boolean> {
    switch (event) {
      case 'installation':
        return this.onInstallation(p);
      case 'installation_repositories':
        return this.onInstallationRepositories(p);
      case 'pull_request':
        return this.onPullRequest(p);
      case 'pull_request_review':
        return this.onReview(p);
      case 'check_suite':
        return this.onCheckSuite(p);
      default:
        return Promise.resolve(false); // ping and anything we don't use
    }
  }

  // ---- Installation lifecycle -------------------------------------------

  private async onInstallation(p: Json) {
    if (p.action !== 'deleted' || !p.installation?.id) return false;
    await this.prisma.gitHubInstallation.deleteMany({
      where: { installationId: BigInt(p.installation.id) },
    });
    return true;
  }

  private async onInstallationRepositories(p: Json) {
    const removed: { id: number }[] = p.repositories_removed ?? [];
    if (!removed.length) return false;
    await this.prisma.gitHubRepository.deleteMany({
      where: { githubId: { in: removed.map((r) => BigInt(r.id)) } },
    });
    return true;
  }

  // ---- Pull requests -----------------------------------------------------

  /** Finds the repo link, checking the delivery came from its installation. */
  private async repoFor(p: Json) {
    if (!p.repository?.id) return null;
    const repo = await this.prisma.gitHubRepository.findUnique({
      where: { githubId: BigInt(p.repository.id) },
      include: { project: true, installation: true },
    });
    if (!repo) return null;
    if (
      p.installation?.id &&
      BigInt(p.installation.id) !== repo.installation.installationId
    ) {
      return null;
    }
    return repo;
  }

  /** Task keys (e.g. DEV-124) in the branch name, title or description. */
  private async findTask(
    projectId: string,
    projectKey: string,
    texts: (string | null)[],
  ) {
    const re = new RegExp(`(?<![A-Z0-9])${projectKey}-(\\d+)(?!\\d)`, 'i');
    for (const text of texts) {
      const m = text ? re.exec(text) : null;
      if (m) {
        const task = await this.prisma.task.findUnique({
          where: { projectId_number: { projectId, number: Number(m[1]) } },
        });
        if (task) return task;
      }
    }
    return null;
  }

  /** Tells a task's assignee (or its reporter if unassigned) about PR news. */
  private async notifyPr(
    repo: { project: { key: string; workspaceId: string } },
    task: {
      id: string;
      number: number;
      title: string;
      assigneeId: string | null;
      reporterId: string;
    } | null,
    text: string,
  ) {
    if (!task) return;
    await this.notifications.notify({
      type: 'PULL_REQUEST',
      recipients: [task.assigneeId ?? task.reporterId],
      workspaceId: repo.project.workspaceId,
      message: `${text} (${taskLabel(`${repo.project.key}-${task.number}`, task.title)})`,
      link: `/tasks/${task.id}`,
    });
  }

  private async onPullRequest(p: Json) {
    const repo = await this.repoFor(p);
    const pr = p.pull_request;
    if (!repo || !pr) return false;

    const task = await this.findTask(repo.projectId, repo.project.key, [
      pr.head?.ref,
      pr.title,
      pr.body,
    ]);
    const merged = Boolean(pr.merged);
    const where = {
      repositoryId_number: { repositoryId: repo.id, number: pr.number },
    };
    const before = await this.prisma.pullRequest.findUnique({ where });

    const fields = {
      title: String(pr.title).slice(0, 500),
      url: safeHttpsUrl(pr.html_url),
      state: pr.state === 'open' ? 'open' : 'closed',
      draft: Boolean(pr.draft),
      merged,
      headBranch: String(pr.head?.ref ?? ''),
      headSha: String(pr.head?.sha ?? ''),
      author: String(pr.user?.login ?? 'unknown'),
      mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
      taskId: task?.id ?? null,
      // New commits invalidate earlier CI results.
      ...(before && before.headSha !== pr.head?.sha
        ? { checksState: 'pending' }
        : {}),
      ...(p.action === 'review_requested' && !before?.reviewState
        ? { reviewState: 'review_requested' }
        : {}),
    };

    await this.prisma.pullRequest.upsert({
      where,
      create: {
        ...fields,
        repositoryId: repo.id,
        number: pr.number,
        openedAt: new Date(pr.created_at),
      },
      update: fields,
    });

    // Task history is appended only when something meaningful changed.
    const events: { type: string; data: Prisma.InputJsonValue }[] = [];
    const info = { number: pr.number, title: fields.title };
    if (task && before?.taskId !== task.id)
      events.push({ type: 'pr_linked', data: info });
    if (task && merged && !before?.merged)
      events.push({ type: 'pr_merged', data: info });
    if (task && events.length) {
      await this.prisma.taskActivity.createMany({
        data: events.map((e) => ({
          taskId: task.id,
          actorId: 'github',
          type: e.type,
          data: e.data,
        })),
      });
    }
    if (task && before?.taskId !== task.id) {
      await this.notifyPr(repo, task, `Pull request #${pr.number} was linked`);
    }
    if (task && merged && !before?.merged) {
      await this.notifyPr(repo, task, `Pull request #${pr.number} was merged`);
    }
    return true;
  }

  private async onReview(p: Json) {
    const repo = await this.repoFor(p);
    if (!repo || !p.pull_request?.number) return false;
    let reviewState: string | null | undefined;
    if (p.action === 'dismissed') reviewState = null;
    else if (p.action === 'submitted') {
      const state = String(p.review?.state ?? '').toLowerCase();
      if (state === 'approved' || state === 'changes_requested')
        reviewState = state;
    }
    if (reviewState === undefined) return false; // plain comments don't change the status
    const where = { repositoryId: repo.id, number: p.pull_request.number };
    const { count } = await this.prisma.pullRequest.updateMany({
      where,
      data: { reviewState },
    });
    if (reviewState) {
      const pr = await this.prisma.pullRequest.findFirst({
        where,
        include: { task: true },
      });
      await this.notifyPr(
        repo,
        pr?.task ?? null,
        reviewState === 'approved'
          ? `Pull request #${p.pull_request.number} was approved`
          : `Changes were requested on pull request #${p.pull_request.number}`,
      );
    }
    return count > 0;
  }

  private async onCheckSuite(p: Json) {
    const repo = await this.repoFor(p);
    const suite = p.check_suite;
    if (!repo || !suite?.head_sha) return false;
    let checksState: string;
    if (suite.status !== 'completed') checksState = 'pending';
    else if (['success', 'neutral', 'skipped'].includes(suite.conclusion))
      checksState = 'success';
    else checksState = 'failure';
    const where = {
      repositoryId: repo.id,
      headSha: suite.head_sha,
      state: 'open',
    };
    // Only PRs that weren't already failing, so repeated events don't re-notify.
    const newlyFailing =
      checksState === 'failure'
        ? await this.prisma.pullRequest.findMany({
            // checksState is null until the first result, and SQL's
            // "!= 'failure'" would skip null rows, so match them explicitly.
            where: {
              ...where,
              OR: [{ checksState: null }, { checksState: { not: 'failure' } }],
            },
            include: { task: true },
          })
        : [];
    const { count } = await this.prisma.pullRequest.updateMany({
      where,
      data: { checksState },
    });
    for (const pr of newlyFailing) {
      await this.notifyPr(
        repo,
        pr.task,
        `Checks failed on pull request #${pr.number}`,
      );
    }
    return count > 0;
  }
}
