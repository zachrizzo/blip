-- Drop the non-unique index superseded by the partial unique index below
DROP INDEX IF EXISTS "agent_chat_threads_agent_issue_idx";

-- Enforce at most one thread per (agent_id, issue_id) pair.
-- Rows with issue_id IS NULL are excluded so multiple general/manual threads per agent are allowed.
CREATE UNIQUE INDEX "agent_chat_threads_agent_issue_uq"
  ON "agent_chat_threads" ("agent_id", "issue_id")
  WHERE "issue_id" IS NOT NULL;
