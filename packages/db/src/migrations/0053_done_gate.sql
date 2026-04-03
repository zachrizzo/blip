ALTER TABLE "issues" ADD COLUMN "closed_by_agent_id" uuid REFERENCES "agents"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "closed_by_user_id" text;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "done_gate_agent_ids" jsonb;
