import type { Label } from "@/components/labels";

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export const PRIORITIES: Priority[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export const priorityStyle: Record<Priority, string> = {
  LOW: "text-muted border-border",
  MEDIUM: "text-branch border-branch/30 bg-branch/10",
  HIGH: "text-warning border-warning/30 bg-warning/10",
  CRITICAL: "text-critical border-critical/30 bg-critical/10",
};

export const priorityLabel = (p: Priority) =>
  p.charAt(0) + p.slice(1).toLowerCase();

export interface BoardTask {
  id: string;
  key: string;
  title: string;
  priority: Priority;
  storyPoints: number | null;
  blocked: boolean;
  position: number;
  assignee: { id: string; name: string } | null;
  labels: Label[];
}

export interface BoardColumn {
  id: string;
  name: string;
  category: string;
  wipLimit: number | null;
  tasks: BoardTask[];
}

export interface Board {
  project: { id: string; name: string; key: string; status: string };
  columns: BoardColumn[];
}
