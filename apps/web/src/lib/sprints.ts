import type { Label } from "@/components/labels";
import type { Priority } from "./tasks";

export interface PlanTask {
  id: string;
  key: string;
  title: string;
  priority: Priority;
  storyPoints: number | null;
  blocked: boolean;
  backlogRank: number;
  status: { name: string; category: string };
  assignee: { id: string; name: string } | null;
  labels: Label[];
}

export interface PlanSprint {
  id: string;
  name: string;
  goal: string;
  startDate: string;
  endDate: string;
  status: "PLANNING" | "ACTIVE" | "COMPLETED";
  points: number;
  tasks: PlanTask[];
}

export interface BacklogData {
  project: { id: string; name: string; key: string };
  permissions: { planBacklog: boolean; manageSprints: boolean };
  sprints: PlanSprint[];
  backlog: PlanTask[];
  completed: { id: string; name: string; completedAt: string }[];
}

export interface ReportItem {
  taskId: string;
  key: string;
  title: string;
  points: number;
}

export interface SprintReport {
  sprint: {
    id: string;
    name: string;
    goal: string;
    status: "PLANNING" | "ACTIVE" | "COMPLETED";
    startDate: string;
    endDate: string;
    startedAt: string | null;
    completedAt: string | null;
  };
  project: { id: string; name: string };
  final: boolean;
  committedPoints: number;
  completedPoints: number;
  completedCommittedPoints: number;
  addedPoints: number;
  removedPoints: number;
  completionRate: number | null;
  committed: ReportItem[];
  added: ReportItem[];
  removed: ReportItem[];
  completed: ReportItem[];
  incomplete: ReportItem[];
}

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

/** Position for an item dropped at `index` among `others` (sorted by rank). */
export function rankAt(ranks: number[], index: number) {
  const prev = ranks[index - 1];
  const next = ranks[index];
  if (prev === undefined && next === undefined) return 1000;
  if (prev === undefined) return next - 1000;
  if (next === undefined) return prev + 1000;
  return (prev + next) / 2;
}
