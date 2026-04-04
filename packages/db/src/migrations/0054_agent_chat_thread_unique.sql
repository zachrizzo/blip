-- Deduplicate (agent_id, issue_id) pairs: keep oldest thread, reassign messages, then remove extras
DO $$
DECLARE
  canonical_id uuid;
  dup RECORD;
BEGIN
  FOR dup IN
    SELECT t.id, t.agent_id, t.issue_id,
           (SELECT id FROM agent_chat_threads
            WHERE agent_id = t.agent_id AND issue_id = t.issue_id AND issue_id IS NOT NULL
            ORDER BY created_at ASC LIMIT 1) AS keep_id
    FROM agent_chat_threads t
    WHERE t.issue_id IS NOT NULL
      AND t.id != (SELECT id FROM agent_chat_threads
                   WHERE agent_id = t.agent_id AND issue_id = t.issue_id AND issue_id IS NOT NULL
                   ORDER BY created_at ASC LIMIT 1)
  LOOP
    -- Reassign any child rows from the duplicate thread to the canonical thread
    UPDATE agent_messages SET thread_id = dup.keep_id WHERE thread_id = dup.id;
    UPDATE heartbeat_runs SET thread_id = dup.keep_id WHERE thread_id = dup.id;
    -- Delete the duplicate thread
    DELETE FROM agent_chat_threads WHERE id = dup.id;
  END LOOP;
END $$;

-- Drop the non-unique index superseded by the partial unique index below
DROP INDEX IF EXISTS "agent_chat_threads_agent_issue_idx";

-- Enforce at most one thread per (agent_id, issue_id) pair.
-- Rows with issue_id IS NULL are excluded so multiple general/manual threads per agent are allowed.
CREATE UNIQUE INDEX "agent_chat_threads_agent_issue_uq"
  ON "agent_chat_threads" ("agent_id", "issue_id")
  WHERE "issue_id" IS NOT NULL;
