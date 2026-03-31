import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { issues } from "./issues.js";

export const agentChatThreads = pgTable(
  "agent_chat_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    issueId: uuid("issue_id").references(() => issues.id), // null = manual/general thread
    title: text("title"), // user-facing label, auto-generated or manual
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentIdx: index("agent_chat_threads_agent_idx").on(table.agentId),
    agentIssueIdx: index("agent_chat_threads_agent_issue_idx").on(table.agentId, table.issueId),
  }),
);
