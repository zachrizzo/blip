import { eq, and, or, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agentBlocklistRules } from "@paperclipai/db";
import { notFound } from "../errors.js";

export type BlocklistRule = typeof agentBlocklistRules.$inferSelect;

type CreateInput = {
  companyId: string;
  agentId?: string | null;
  ruleType: string;
  pattern: string;
  description?: string;
  enforcement?: string;
};

type UpdateInput = Partial<{
  pattern: string;
  description: string;
  enforcement: string;
  isActive: boolean;
}>;

const LABEL: Record<string, string> = {
  file: "Do NOT modify files matching",
  command: "Do NOT run commands matching",
  tool: "Do NOT use tools matching",
  custom: "Custom",
};

export function blocklistService(db: Db) {
  /** Get all active rules for an agent (agent-specific + company-wide). */
  async function getActiveRules(agentId: string, companyId: string): Promise<BlocklistRule[]> {
    return db
      .select()
      .from(agentBlocklistRules)
      .where(
        and(
          eq(agentBlocklistRules.companyId, companyId),
          eq(agentBlocklistRules.isActive, true),
          or(eq(agentBlocklistRules.agentId, agentId), isNull(agentBlocklistRules.agentId)),
        ),
      );
  }

  /** Format rules into a prompt section for injection. Returns null if no rules. */
  function formatForPrompt(rules: BlocklistRule[]): string | null {
    if (rules.length === 0) return null;

    const lines = rules.map((r) => {
      const tag = r.enforcement === "warn" ? "WARN" : "BLOCK";
      const label = LABEL[r.ruleType] ?? "Custom";
      return `- [${tag}] ${label}: ${r.pattern}`;
    });

    return `## BLOCKLIST — You MUST NOT do the following:\n${lines.join("\n")}`;
  }

  /** List rules scoped to a specific agent (agent-specific + company-wide). */
  async function listForAgent(agentId: string, companyId: string): Promise<BlocklistRule[]> {
    return db
      .select()
      .from(agentBlocklistRules)
      .where(
        and(
          eq(agentBlocklistRules.companyId, companyId),
          or(eq(agentBlocklistRules.agentId, agentId), isNull(agentBlocklistRules.agentId)),
        ),
      );
  }

  /** List all rules for a company (regardless of agent). */
  async function listForCompany(companyId: string): Promise<BlocklistRule[]> {
    return db
      .select()
      .from(agentBlocklistRules)
      .where(eq(agentBlocklistRules.companyId, companyId));
  }

  /** Create a new blocklist rule. */
  async function create(data: CreateInput): Promise<BlocklistRule> {
    const rows = await db
      .insert(agentBlocklistRules)
      .values({
        companyId: data.companyId,
        agentId: data.agentId ?? null,
        ruleType: data.ruleType,
        pattern: data.pattern,
        description: data.description ?? null,
        enforcement: data.enforcement ?? "block",
      })
      .returning();
    return rows[0]!;
  }

  /** Update an existing blocklist rule. */
  async function update(id: string, data: UpdateInput): Promise<BlocklistRule> {
    const rows = await db
      .update(agentBlocklistRules)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(agentBlocklistRules.id, id))
      .returning();
    if (rows.length === 0) throw notFound("Blocklist rule not found");
    return rows[0]!;
  }

  /** Delete a blocklist rule. */
  async function remove(id: string): Promise<void> {
    const rows = await db
      .delete(agentBlocklistRules)
      .where(eq(agentBlocklistRules.id, id))
      .returning();
    if (rows.length === 0) throw notFound("Blocklist rule not found");
  }

  return {
    getActiveRules,
    formatForPrompt,
    listForAgent,
    listForCompany,
    create,
    update,
    remove,
  };
}
