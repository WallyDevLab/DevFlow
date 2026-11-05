-- AlterTable
ALTER TABLE "WorkflowStatus" ADD COLUMN     "wipLimit" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowStatus_projectId_name_key" ON "WorkflowStatus"("projectId", "name");

-- Backfill: stamp existing history with the stage category each status had.
-- Analytics reads these instead of matching status NAMES, so renaming or
-- re-categorising a column later can't change the meaning of past events.
UPDATE "TaskActivity" a
SET data = a.data
  || COALESCE((
       SELECT jsonb_build_object('toCategory', s.category::text)
       FROM "WorkflowStatus" s
       WHERE s."projectId" = t."projectId" AND s.name = a.data->>'to'
     ), '{}'::jsonb)
  || COALESCE((
       SELECT jsonb_build_object('fromCategory', s.category::text)
       FROM "WorkflowStatus" s
       WHERE s."projectId" = t."projectId" AND s.name = a.data->>'from'
     ), '{}'::jsonb)
FROM "Task" t
WHERE t.id = a."taskId" AND a.type = 'status_changed' AND a.data IS NOT NULL;

UPDATE "TaskActivity" a
SET data = a.data
  || COALESCE((
       SELECT jsonb_build_object('category', s.category::text)
       FROM "WorkflowStatus" s
       WHERE s."projectId" = t."projectId" AND s.name = a.data->>'status'
     ), '{}'::jsonb)
FROM "Task" t
WHERE t.id = a."taskId" AND a.type = 'created' AND a.data IS NOT NULL;
