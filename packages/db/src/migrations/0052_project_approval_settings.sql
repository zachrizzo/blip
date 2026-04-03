-- Add requireApprovalForStories to projects table
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "require_approval_for_stories" boolean;

-- Migrate existing company-level settings to all projects as defaults
UPDATE "projects" p
SET "require_approval_for_stories" = c."require_approval_for_stories"
FROM "companies" c
WHERE p."company_id" = c."id"
  AND p."require_approval_for_stories" IS NULL;
