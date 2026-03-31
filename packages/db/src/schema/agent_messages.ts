import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";
import { issues } from "./issues.js";
import { agentChatThreads } from "./agent_chat_threads.js";

export const agentMessages = pgTable(
  "agent_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    threadId: uuid("thread_id").references(() => agentChatThreads.id),
    runId: uuid("run_id").references(() => heartbeatRuns.id),
    issueId: uuid("issue_id").references(() => issues.id),
    senderType: text("sender_type").notNull(), // 'user' | 'agent' | 'system'
    senderId: text("sender_id"),
    body: text("body").notNull(),
    status: text("status").notNull().default("pending"), // 'pending' | 'delivered'
    deliveredInRunId: uuid("delivered_in_run_id").references(() => heartbeatRuns.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("agent_messages_company_idx").on(table.companyId),
    agentIdx: index("agent_messages_agent_idx").on(table.agentId),
    runIdx: index("agent_messages_run_idx").on(table.runId),
    agentStatusIdx: index("agent_messages_agent_status_idx").on(table.agentId, table.status),
    threadIdx: index("agent_messages_thread_idx").on(table.threadId),
  }),
);
