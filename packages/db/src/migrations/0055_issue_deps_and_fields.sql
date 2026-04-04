-- Add acceptance criteria and effort estimate to issues
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "acceptance_criteria" text;
ALTER TABLE "issues" ADD COLUMN IF NOT EXISTS "effort_estimate" text;

-- Create issue dependencies table
CREATE TABLE IF NOT EXISTS "issue_dependencies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "blocking_issue_id" uuid NOT NULL REFERENCES "issues"("id") ON DELETE CASCADE,
  "blocked_issue_id" uuid NOT NULL REFERENCES "issues"("id") ON DELETE CASCADE,
  "dependency_type" text NOT NULL DEFAULT 'blocks',
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "issue_deps_blocking_idx" ON "issue_dependencies" ("blocking_issue_id");
CREATE INDEX IF NOT EXISTS "issue_deps_blocked_idx" ON "issue_dependencies" ("blocked_issue_id");
CREATE UNIQUE INDEX IF NOT EXISTS "issue_deps_unique" ON "issue_dependencies" ("blocking_issue_id", "blocked_issue_id");
