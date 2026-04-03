import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agentMessages, agentChatThreads, heartbeatRuns, issues } from "@paperclipai/db";

type AgentMessage = typeof agentMessages.$inferSelect;
type AgentChatThread = typeof agentChatThreads.$inferSelect;

type ThreadWithRun = AgentChatThread & {
  runId: string | null;
  runStatus: string | null;
  runStartedAt: Date | null;
  runFinishedAt: Date | null;
};

export function agentMessageService(db: Db) {
  // ─── Threads ────────────────────────────────────────────────────────

  async function listThreads(agentId: string): Promise<ThreadWithRun[]> {
    const rows = await db
      .select({
        id: agentChatThreads.id,
        companyId: agentChatThreads.companyId,
        agentId: agentChatThreads.agentId,
        issueId: agentChatThreads.issueId,
        title: agentChatThreads.title,
        createdAt: agentChatThreads.createdAt,
        updatedAt: agentChatThreads.updatedAt,
        runId: heartbeatRuns.id,
        runStatus: heartbeatRuns.status,
        runStartedAt: heartbeatRuns.startedAt,
        runFinishedAt: heartbeatRuns.finishedAt,
      })
      .from(agentChatThreads)
      .leftJoin(heartbeatRuns, eq(heartbeatRuns.threadId, agentChatThreads.id))
      .where(eq(agentChatThreads.agentId, agentId))
      .orderBy(
        desc(agentChatThreads.updatedAt),
        desc(heartbeatRuns.createdAt),
        desc(heartbeatRuns.startedAt),
      );

    // Deduplicate: a thread with N runs produces N rows via the LEFT JOIN.
    // Query ordering guarantees the first row is the newest run for that thread.
    const map = new Map<string, ThreadWithRun>();
    for (const row of rows) {
      if (!map.has(row.id)) map.set(row.id, row);
    }
    return [...map.values()].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  async function getThread(threadId: string): Promise<AgentChatThread | null> {
    const rows = await db.select().from(agentChatThreads).where(eq(agentChatThreads.id, threadId));
    return rows[0] ?? null;
  }

  async function createThread(data: {
    companyId: string;
    agentId: string;
    issueId?: string | null;
    title?: string | null;
  }): Promise<AgentChatThread> {
    const [thread] = await db
      .insert(agentChatThreads)
      .values({
        companyId: data.companyId,
        agentId: data.agentId,
        issueId: data.issueId ?? null,
        title: data.title ?? null,
      })
      .returning();
    return thread!;
  }

  async function getOrCreateThreadForIssue(
    companyId: string,
    agentId: string,
    issueId: string,
    issueTitle?: string | null,
  ): Promise<AgentChatThread> {
    const existing = await db
      .select()
      .from(agentChatThreads)
      .where(and(eq(agentChatThreads.agentId, agentId), eq(agentChatThreads.issueId, issueId)));
    if (existing[0]) return existing[0];

    // Use provided title or simple fallback (issue ID prefix)
    // IMPORTANT: Do NOT query the issues table here to avoid deadlocks
    // The title can be updated later or retrieved from the UI
    const title = issueTitle ?? issueId.slice(0, 8);

    return createThread({ companyId, agentId, issueId, title });
  }

  async function getRunForThread(threadId: string): Promise<typeof heartbeatRuns.$inferSelect | null> {
    const rows = await db
      .select()
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.threadId, threadId))
      .orderBy(desc(heartbeatRuns.createdAt), desc(heartbeatRuns.startedAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async function touchThread(threadId: string): Promise<void> {
    await db
      .update(agentChatThreads)
      .set({ updatedAt: new Date() })
      .where(eq(agentChatThreads.id, threadId));
  }

  // ─── Messages ───────────────────────────────────────────────────────

  async function getPendingMessages(agentId: string): Promise<AgentMessage[]> {
    return db
      .select()
      .from(agentMessages)
      .where(and(eq(agentMessages.agentId, agentId), eq(agentMessages.status, "pending")))
      .orderBy(asc(agentMessages.createdAt));
  }

  async function getMessagesForRun(runId: string): Promise<AgentMessage[]> {
    return db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.runId, runId))
      .orderBy(asc(agentMessages.createdAt));
  }

  async function getMessagesForThread(threadId: string, limit = 200): Promise<AgentMessage[]> {
    return db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.threadId, threadId))
      .orderBy(asc(agentMessages.createdAt))
      .limit(limit);
  }

  async function sendMessage(data: {
    companyId: string;
    agentId: string;
    threadId?: string | null;
    runId?: string;
    issueId?: string;
    senderType: "user" | "agent" | "system";
    senderId?: string;
    body: string;
  }): Promise<AgentMessage> {
    const [message] = await db
      .insert(agentMessages)
      .values({
        companyId: data.companyId,
        agentId: data.agentId,
        threadId: data.threadId ?? null,
        runId: data.runId ?? null,
        issueId: data.issueId ?? null,
        senderType: data.senderType,
        senderId: data.senderId ?? null,
        body: data.body,
        status: data.senderType === "agent" ? "delivered" : "pending",
      })
      .returning();

    // Touch thread updatedAt
    if (data.threadId) {
      await touchThread(data.threadId).catch(() => {});
    }

    return message!;
  }

  async function markDelivered(messageIds: string[], runId: string): Promise<void> {
    if (messageIds.length === 0) return;
    await db
      .update(agentMessages)
      .set({ status: "delivered", deliveredInRunId: runId, updatedAt: new Date() })
      .where(inArray(agentMessages.id, messageIds));
  }

  async function listForAgent(agentId: string, limit = 50): Promise<AgentMessage[]> {
    return db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.agentId, agentId))
      .orderBy(desc(agentMessages.createdAt))
      .limit(limit);
  }

  return {
    listThreads,
    getThread,
    createThread,
    getOrCreateThreadForIssue,
    touchThread,
    getRunForThread,
    getPendingMessages,
    getMessagesForRun,
    getMessagesForThread,
    sendMessage,
    markDelivered,
    listForAgent,
  };
}
