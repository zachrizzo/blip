ALTER TABLE "companies" ADD COLUMN "industry" text;
ALTER TABLE "companies" ADD COLUMN "team_size" integer;
ALTER TABLE "companies" ADD COLUMN "primary_use_case" text;
ALTER TABLE "companies" ADD COLUMN "onboarding_complete" boolean NOT NULL DEFAULT false;
ALTER TABLE "companies" ADD COLUMN "onboarding_thread_id" uuid;
