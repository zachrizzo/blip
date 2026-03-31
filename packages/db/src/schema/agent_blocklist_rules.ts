import { pgTable, uuid, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

export const agentBlocklistRules = pgTable(
  "agent_blocklist_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    agentId: uuid("agent_id").references(() => agents.id), // null = company-wide
    ruleType: text("rule_type").notNull(), // 'file' | 'command' | 'tool' | 'custom'
    pattern: text("pattern").notNull(),
    description: text("description"),
    enforcement: text("enforcement").notNull().default("block"), // 'block' | 'warn'
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("agent_blocklist_rules_company_idx").on(table.companyId),
    agentIdx: index("agent_blocklist_rules_agent_idx").on(table.agentId),
    companyActiveIdx: index("agent_blocklist_rules_company_active_idx").on(
      table.companyId,
      table.isActive,
    ),
  }),
);
