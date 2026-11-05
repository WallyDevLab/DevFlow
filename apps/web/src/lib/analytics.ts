export interface Summary {
  n: number;
  average: number | null;
  median: number | null;
  p85: number | null;
  lowSample: boolean;
}

export interface Analytics {
  project: { id: string; name: string; key: string };
  hasRepository: boolean;
  range: { from: string; to: string };
  definition: "done" | "merged";
  cycleTime: Summary & {
    timeInStage: {
      inProgressDays: number | null;
      inReviewDays: number | null;
      blockedDays: number | null;
    };
  };
  leadTime: Summary & { definition: "done" | "merged" };
  weekly: {
    weekStart: string;
    completed: number;
    medianCycleDays: number | null;
  }[];
  sprints: {
    id: string;
    name: string;
    completedAt: string;
    committedPoints: number;
    completedPoints: number;
    addedPoints: number;
    removedPoints: number;
    completionRate: number | null;
  }[];
  wip: {
    total: number;
    blockedNow: number;
    byStatus: { name: string; category: string; count: number }[];
  };
  blocked: {
    tasks: number;
    totalDays: number;
    averageDays: number | null;
    current: {
      taskId: string;
      key: string;
      title: string;
      reason: string | null;
      days: number;
    }[];
  };
  github: {
    opened: number;
    merged: number;
    medianHoursToMerge: number | null;
    lowSample: boolean;
  };
  completedTasks: {
    taskId: string;
    key: string;
    title: string;
    startedAt: string | null;
    completedAt: string;
    cycleDays: number | null;
    leadDays: number;
    blockedDays: number;
  }[];
}
