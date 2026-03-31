-- Agent messages table for chat/steering
CREATE TABLE IF NOT EXISTS "agent_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "agent_id" uuid NOT NULL REFERENCES "agents"("id"),
  "run_id" uuid REFERENCES "heartbeat_runs"("id"),
  "issue_id" uuid REFERENCES "issues"("id"),
  "sender_type" text NOT NULL,
  "sender_id" text,
  "body" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "delivered_in_run_id" uuid REFERENCES "heartbeat_runs"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "agent_messages_company_idx" ON "agent_messages" ("company_id");
CREATE INDEX IF NOT EXISTS "agent_messages_agent_idx" ON "agent_messages" ("agent_id");
CREATE INDEX IF NOT EXISTS "agent_messages_run_idx" ON "agent_messages" ("run_id");
CREATE INDEX IF NOT EXISTS "agent_messages_agent_status_idx" ON "agent_messages" ("agent_id", "status");

-- Agent blocklist rules table
CREATE TABLE IF NOT EXISTS "agent_blocklist_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"),
  "agent_id" uuid REFERENCES "agents"("id"),
  "rule_type" text NOT NULL,
  "pattern" text NOT NULL,
  "description" text,
  "enforcement" text NOT NULL DEFAULT 'block',
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "agent_blocklist_rules_company_idx" ON "agent_blocklist_rules" ("company_id");
CREATE INDEX IF NOT EXISTS "agent_blocklist_rules_agent_idx" ON "agent_blocklist_rules" ("agent_id");
CREATE INDEX IF NOT EXISTS "agent_blocklist_rules_company_active_idx" ON "agent_blocklist_rules" ("company_id", "is_active");

-- Story approval toggle on companies
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "require_approval_for_stories" boolean NOT NULL DEFAULT false;
