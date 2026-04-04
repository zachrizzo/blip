import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, companies, costEvents, goals } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

/**
 * Enriches a heartbeat run context with company info, goals, org chain,
 * and budget data so the agent has richer situational awareness.
 */
export async function enrichRunContext(
  db: Db,
  agent: {
    id: string;
    companyId: string;
    reportsTo: string | null;
    budgetMonthlyCents: number;
  },
  context: Record<string, unknown>,
): Promise<void> {
  // --- Company info ---
  try {
    const row = await db
      .select({
        name: companies.name,
        description: companies.description,
        industry: companies.industry,
        primaryUseCase: companies.primaryUseCase,
      })
      .from(companies)
      .where(eq(companies.id, agent.companyId))
      .then((rows) => rows[0] ?? null);
    if (row) {
      context.paperclipCompany = {
        name: row.name,
        description: row.description ?? undefined,
        industry: row.industry ?? undefined,
        primaryUseCase: row.primaryUseCase ?? undefined,
      };
    }
  } catch (e) {
    logger.warn(e, "Failed to load company info for agent %s", agent.id);
  }

  // --- Goals (max 10 compact entries) ---
  try {
    const rows = await db
      .select({
        id: goals.id,
        title: goals.title,
        level: goals.level,
        status: goals.status,
      })
      .from(goals)
      .where(eq(goals.companyId, agent.companyId))
      .limit(10);
    if (rows.length > 0) {
      context.paperclipGoals = rows;
    }
  } catch (e) {
    logger.warn(e, "Failed to load goals for agent %s", agent.id);
  }

  // --- Org chain (walk reportsTo upward, max 10 hops) ---
  try {
    const chain: Array<{ id: string; name: string; title: string | null; role: string }> = [];
    let currentManagerId = agent.reportsTo;
    const visited = new Set<string>();
    while (currentManagerId && chain.length < 10) {
      if (visited.has(currentManagerId)) break;
      visited.add(currentManagerId);
      const manager = await db
        .select({
          id: agents.id,
          name: agents.name,
          title: agents.title,
          role: agents.role,
          reportsTo: agents.reportsTo,
        })
        .from(agents)
        .where(eq(agents.id, currentManagerId))
        .then((rows) => rows[0] ?? null);
      if (!manager) break;
      chain.push({ id: manager.id, name: manager.name, title: manager.title, role: manager.role });
      currentManagerId = manager.reportsTo;
    }
    if (chain.length > 0) {
      context.paperclipOrgChain = chain;
    }
  } catch (e) {
    logger.warn(e, "Failed to load org chain for agent %s", agent.id);
  }

  // --- Budget info + utilization warning ---
  try {
    if (agent.budgetMonthlyCents > 0) {
      // Compute actual monthly spend from cost_events
      let spendCents = 0;
      try {
        const now = new Date();
        const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
        const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
        const [row] = await db
          .select({
            total: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::int`,
          })
          .from(costEvents)
          .where(
            and(
              eq(costEvents.companyId, agent.companyId),
              eq(costEvents.agentId, agent.id),
              gte(costEvents.occurredAt, monthStart),
              lt(costEvents.occurredAt, monthEnd),
            ),
          );
        spendCents = Number(row?.total ?? 0);
      } catch (e) {
        logger.warn(e, "Failed to query monthly spend for agent %s", agent.id);
      }

      const utilizationPercent =
        agent.budgetMonthlyCents > 0
          ? (spendCents / agent.budgetMonthlyCents) * 100
          : 0;

      context.paperclipBudget = {
        monthlyCents: agent.budgetMonthlyCents,
        spentCents: spendCents,
        utilizationPercent: Number(utilizationPercent.toFixed(2)),
      };

      if (utilizationPercent >= 80) {
        context.paperclipBudgetWarning =
          utilizationPercent >= 100
            ? `BUDGET EXCEEDED: You have spent ${spendCents} cents of your ${agent.budgetMonthlyCents} cent monthly budget (${utilizationPercent.toFixed(1)}%). Finish current work and avoid starting new expensive tasks.`
            : `BUDGET WARNING: You have used ${utilizationPercent.toFixed(1)}% of your monthly budget (${spendCents} of ${agent.budgetMonthlyCents} cents). Be cost-conscious and avoid unnecessary tool calls.`;
      }
    }
  } catch (e) {
    logger.warn(e, "Failed to load budget info for agent %s", agent.id);
  }
}
