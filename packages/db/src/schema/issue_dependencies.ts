import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

export const issueDependencies = pgTable("issue_dependencies", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id),
  blockingIssueId: uuid("blocking_issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
  blockedIssueId: uuid("blocked_issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
  dependencyType: text("dependency_type").notNull().default("blocks"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  blockingIdx: index("issue_deps_blocking_idx").on(table.blockingIssueId),
  blockedIdx: index("issue_deps_blocked_idx").on(table.blockedIssueId),
  uniqueDep: uniqueIndex("issue_deps_unique").on(table.blockingIssueId, table.blockedIssueId),
}));
