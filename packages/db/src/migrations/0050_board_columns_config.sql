ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "board_columns_config" jsonb;
