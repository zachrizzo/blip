-- Step 1: add nullable column
ALTER TABLE "heartbeat_runs"
  ADD COLUMN IF NOT EXISTS "thread_id" uuid REFERENCES "agent_chat_threads"("id");

-- Step 2: backfill — create one thread per existing run
INSERT INTO "agent_chat_threads" ("id", "company_id", "agent_id", "issue_id", "title", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  r.company_id,
  r.agent_id,
  (r.context_snapshot ->> 'issueId')::uuid,
  CASE
    WHEN r.invocation_source = 'timer' THEN 'Timer · ' || to_char(r.created_at AT TIME ZONE 'UTC', 'Mon DD h:MI AM')
    WHEN r.invocation_source = 'automation' THEN 'Automation · ' || to_char(r.created_at AT TIME ZONE 'UTC', 'Mon DD h:MI AM')
    ELSE 'On-demand · ' || to_char(r.created_at AT TIME ZONE 'UTC', 'Mon DD h:MI AM')
  END,
  r.created_at,
  r.created_at
FROM "heartbeat_runs" r
WHERE r.thread_id IS NULL;

-- Step 3: link runs to their newly created threads
-- Match by agent_id + created_at (unique per run since we just inserted them)
UPDATE "heartbeat_runs" r
SET thread_id = t.id
FROM "agent_chat_threads" t
WHERE r.thread_id IS NULL
  AND t.agent_id = r.agent_id
  AND t.created_at = r.created_at;

-- Step 4: enforce NOT NULL
ALTER TABLE "heartbeat_runs"
  ALTER COLUMN "thread_id" SET NOT NULL;

-- Step 5: add index
CREATE INDEX IF NOT EXISTS "heartbeat_runs_thread_id_idx" ON "heartbeat_runs" ("thread_id");

-- Step 6: backfill threadId on messages that have runId but no threadId
UPDATE "agent_messages" m
SET thread_id = r.thread_id
FROM "heartbeat_runs" r
WHERE m.run_id = r.id
  AND m.thread_id IS NULL;
