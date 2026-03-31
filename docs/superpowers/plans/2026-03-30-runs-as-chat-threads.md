# Runs as Chat Threads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every agent run is automatically associated with a chat thread; threads are the primary entity; the Chat tab shows all runs as conversations with full Claude Code-style transcript inline.

**Architecture:** Add `thread_id NOT NULL` to `heartbeat_runs`. `enqueueWakeup` auto-creates a thread before inserting a new run (or uses a provided `threadId`). The `listThreads` query joins with `heartbeat_runs` to surface run status. The Chat tab's `ThreadChat` component shows the thread's specific run transcript inline, always expanded, replacing the current "show work" toggle.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, Express, React, TanStack Query

---

## File Map

| File | Change |
|------|--------|
| `packages/db/src/migrations/0047_runs_thread_id.sql` | CREATE — migration: add `thread_id` to `heartbeat_runs`, backfill, NOT NULL |
| `packages/db/src/schema/heartbeat_runs.ts` | MODIFY — add `threadId` column |
| `server/src/services/agent-messages.ts` | MODIFY — `listThreads` joins runs; add `getRunForThread` |
| `server/src/services/heartbeat.ts` | MODIFY — `WakeupOptions` gets `threadId?`; `enqueueWakeup` auto-creates thread |
| `server/src/routes/agents.ts` | MODIFY — invoke route passes threadId; thread send-message passes threadId to wakeup; add two new GET routes |
| `ui/src/api/agents.ts` | MODIFY — `ChatThread` type gets run fields; add `getThreadRun`, `getThreadRunEvents` |
| `ui/src/components/AgentChatView.tsx` | MODIFY — thread list shows run status badge; `ThreadChat` uses thread's run for transcript |

---

### Task 1: DB Migration — add `thread_id` to `heartbeat_runs`

**Files:**
- Create: `packages/db/src/migrations/0047_runs_thread_id.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Step 1: add nullable column
ALTER TABLE "heartbeat_runs"
  ADD COLUMN IF NOT EXISTS "thread_id" uuid REFERENCES "agent_chat_threads"("id");

-- Step 2: backfill — create one thread per existing run (batch insert via subquery)
INSERT INTO "agent_chat_threads" ("id", "company_id", "agent_id", "issue_id", "title", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  r.company_id,
  r.agent_id,
  (r.context_snapshot ->> 'issueId')::uuid,
  CASE
    WHEN r.invocation_source = 'timer' THEN 'Timer · ' || to_char(r.created_at AT TIME ZONE 'UTC', 'Mon DD h:MI AM')
    WHEN r.invocation_source = 'automation' THEN 'Automation · ' || to_char(r.created_at AT TIME ZONE 'UTC', 'Mon DD h:MI AM')
    ELSE 'On-demand · ' || to_char(r.created_at AT TIME ZONE 'UTC', 'Mon DD h:MI AM')
  END,
  r.created_at,
  r.created_at
FROM "heartbeat_runs" r
WHERE r.thread_id IS NULL;

-- Step 3: link runs to their newly created threads
-- We match by created_at and agent_id since we just inserted them
UPDATE "heartbeat_runs" r
SET thread_id = t.id
FROM "agent_chat_threads" t
WHERE r.thread_id IS NULL
  AND t.agent_id = r.agent_id
  AND t.created_at = r.created_at;

-- Step 4: enforce NOT NULL
ALTER TABLE "heartbeat_runs"
  ALTER COLUMN "thread_id" SET NOT NULL;

-- Step 5: add index
CREATE INDEX IF NOT EXISTS "heartbeat_runs_thread_id_idx" ON "heartbeat_runs" ("thread_id");

-- Step 6: backfill threadId on messages that have runId but no threadId
UPDATE "agent_messages" m
SET thread_id = r.thread_id
FROM "heartbeat_runs" r
WHERE m.run_id = r.id
  AND m.thread_id IS NULL;
```

- [ ] **Step 2: Verify migration runs without error**

```bash
cd /Users/zachrizzo/Desktop/programming/blip
# Check the DB package has a migrate script
cat packages/db/package.json | grep -A5 '"scripts"'
```

Expected: see a `migrate` or `db:migrate` script. Note it for later use — do NOT run migrations yet, they'll be run in Task 2 after the schema is updated.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/migrations/0047_runs_thread_id.sql
git commit -m "feat: migration — add thread_id to heartbeat_runs"
```

---

### Task 2: Update Drizzle schema for `heartbeat_runs`

**Files:**
- Modify: `packages/db/src/schema/heartbeat_runs.ts`

- [ ] **Step 1: Add the `threadId` column to the schema**

In `packages/db/src/schema/heartbeat_runs.ts`, add an import for `agentChatThreads` and the column. The current imports are:

```ts
import { type AnyPgColumn, pgTable, uuid, text, timestamp, jsonb, index, integer, bigint, boolean } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { agentWakeupRequests } from "./agent_wakeup_requests.js";
```

Add the import:

```ts
import { agentChatThreads } from "./agent_chat_threads.js";
```

Then inside `heartbeatRuns` table definition, after `retryOfRunId`, add:

```ts
    threadId: uuid("thread_id").notNull().references(() => agentChatThreads.id),
```

- [ ] **Step 2: Verify the schema file compiles**

```bash
cd /Users/zachrizzo/Desktop/programming/blip
npx tsc --noEmit -p packages/db/tsconfig.json 2>&1 | head -30
```

Expected: no errors (or only pre-existing errors unrelated to this change).

- [ ] **Step 3: Run the migration**

```bash
# Find and run the migrate command from packages/db
cd /Users/zachrizzo/Desktop/programming/blip
cat packages/db/package.json | grep -A10 '"scripts"'
```

Run the migrate script shown. For example:
```bash
npm run --workspace=packages/db migrate
# or
cd packages/db && npx drizzle-kit migrate
```

Expected: migration 0047 runs successfully with no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/heartbeat_runs.ts
git commit -m "feat: add threadId column to heartbeat_runs schema"
```

---

### Task 3: Service — `agentMessageService`: enrich `listThreads` + add `getRunForThread`

**Files:**
- Modify: `server/src/services/agent-messages.ts`

- [ ] **Step 1: Add `heartbeatRuns` import**

At the top of `server/src/services/agent-messages.ts`, the current imports are:

```ts
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agentMessages, agentChatThreads, issues } from "@paperclipai/db";
```

Change to:

```ts
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agentMessages, agentChatThreads, heartbeatRuns, issues } from "@paperclipai/db";
```

- [ ] **Step 2: Update `listThreads` to join run data**

Replace the current `listThreads` function (lines 11–17):

```ts
async function listThreads(agentId: string): Promise<(AgentChatThread & {
  runId: string | null;
  runStatus: string | null;
  runStartedAt: Date | null;
  runFinishedAt: Date | null;
})[]> {
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
    .orderBy(desc(agentChatThreads.updatedAt));
  return rows;
}
```

- [ ] **Step 3: Add `getRunForThread` function**

After the `touchThread` function, add:

```ts
async function getRunForThread(threadId: string): Promise<typeof heartbeatRuns.$inferSelect | null> {
  const rows = await db
    .select()
    .from(heartbeatRuns)
    .where(eq(heartbeatRuns.threadId, threadId))
    .limit(1);
  return rows[0] ?? null;
}
```

- [ ] **Step 4: Export the new function**

In the `return { ... }` at the bottom of `agentMessageService`, add `getRunForThread`:

```ts
return {
  listThreads,
  getThread,
  createThread,
  getOrCreateThreadForIssue,
  touchThread,
  getRunForThread,        // ← add this
  getPendingMessages,
  getMessagesForRun,
  getMessagesForThread,
  sendMessage,
  markDelivered,
  listForAgent,
};
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/zachrizzo/Desktop/programming/blip
npx tsc --noEmit -p server/tsconfig.json 2>&1 | head -40
```

Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/agent-messages.ts
git commit -m "feat: listThreads joins run data; add getRunForThread"
```

---

### Task 4: Service — `heartbeatService`: auto-create thread on run creation

**Files:**
- Modify: `server/src/services/heartbeat.ts`

- [ ] **Step 1: Find `WakeupOptions` type definition**

```bash
grep -n "WakeupOptions" /Users/zachrizzo/Desktop/programming/blip/server/src/services/heartbeat.ts | head -10
```

Note the line number. Open the file to that line and read the type definition.

- [ ] **Step 2: Add `threadId` to `WakeupOptions`**

Find the `WakeupOptions` type definition (it will look like `type WakeupOptions = { ... }` or `interface WakeupOptions { ... }`). Add `threadId?: string` to it:

```ts
type WakeupOptions = {
  source?: "timer" | "assignment" | "on_demand" | "automation";
  triggerDetail?: "manual" | "ping" | "callback" | "system";
  reason?: string | null;
  payload?: Record<string, unknown> | null;
  contextSnapshot?: Record<string, unknown>;
  requestedByActorType?: "user" | "agent" | "system";
  requestedByActorId?: string | null;
  idempotencyKey?: string | null;
  threadId?: string;   // ← add this
};
```

(Keep any other existing fields — only add `threadId?` to what's already there.)

- [ ] **Step 3: Import `agentMessageService` is already imported — verify**

```bash
grep -n "agentMessageService" /Users/zachrizzo/Desktop/programming/blip/server/src/services/heartbeat.ts | head -5
```

Expected: see `import { agentMessageService } from "./agent-messages.js"` near line 32.

- [ ] **Step 4: Instantiate `agentMessageService` inside `heartbeatService`**

Find where `heartbeatService(db)` starts (line ~825) and look for where other sub-services are instantiated (e.g., `const budgets = budgetService(db)`). Add alongside them:

```ts
const agentMessages = agentMessageService(db);
```

(If it's already there, skip this step.)

- [ ] **Step 5: Add thread auto-creation helper inside `heartbeatService`**

Add this helper function inside `heartbeatService`, before `enqueueWakeup`:

```ts
async function getOrCreateThreadForRun(opts: {
  companyId: string;
  agentId: string;
  source: string;
  threadId?: string;
  issueId?: string | null;
  createdAt?: Date;
}): Promise<string> {
  if (opts.threadId) return opts.threadId;

  // If there's an issueId, use the existing getOrCreateThreadForIssue logic
  if (opts.issueId) {
    const thread = await agentMessages.getOrCreateThreadForIssue(
      opts.companyId,
      opts.agentId,
      opts.issueId,
    );
    return thread.id;
  }

  const now = opts.createdAt ?? new Date();
  const label = now.toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
    hour12: true,
    timeZone: "UTC",
  });
  const sourceLabel =
    opts.source === "timer" ? "Timer" :
    opts.source === "automation" ? "Automation" :
    "On-demand";

  const thread = await agentMessages.createThread({
    companyId: opts.companyId,
    agentId: opts.agentId,
    title: `${sourceLabel} · ${label}`,
  });
  return thread.id;
}
```

- [ ] **Step 6: Update `enqueueWakeup` — issue-path run insertion**

Find the run insertion inside the issue-execution transaction (search for `const newRun = await tx.insert(heartbeatRuns)`). There are two such insertions — the one inside the issue transaction (around line 3455) and one outside it (around line 3580). Update the **issue-path** one:

Before the `const newRun = await tx.insert(heartbeatRuns)...` inside the issue transaction:

```ts
const threadId = await getOrCreateThreadForRun({
  companyId: agent.companyId,
  agentId,
  source,
  threadId: opts.threadId,
  issueId,
});
```

Then add `threadId` to the insert values:

```ts
const newRun = await tx
  .insert(heartbeatRuns)
  .values({
    companyId: agent.companyId,
    agentId,
    invocationSource: source,
    triggerDetail,
    status: "queued",
    wakeupRequestId: wakeupRequest.id,
    contextSnapshot: enrichedContextSnapshot,
    sessionIdBefore: sessionBefore,
    threadId,    // ← add this
  })
  .returning()
  .then((rows) => rows[0]);
```

- [ ] **Step 7: Update `enqueueWakeup` — non-issue-path run insertion**

Find the second `const newRun = await db.insert(heartbeatRuns)` (around line 3580, outside the issue transaction). Before it, add:

```ts
const threadId = await getOrCreateThreadForRun({
  companyId: agent.companyId,
  agentId,
  source,
  threadId: opts.threadId,
  issueId: readNonEmptyString(enrichedContextSnapshot.issueId) ?? null,
});
```

Then add `threadId` to the insert values:

```ts
const newRun = await db
  .insert(heartbeatRuns)
  .values({
    companyId: agent.companyId,
    agentId,
    invocationSource: source,
    triggerDetail,
    status: "queued",
    wakeupRequestId: wakeupRequest.id,
    contextSnapshot: enrichedContextSnapshot,
    sessionIdBefore: sessionBefore,
    threadId,    // ← add this
  })
  .returning()
  .then((rows) => rows[0]);
```

- [ ] **Step 8: Export `getRunForThread` equivalent from heartbeatService**

In the returned object from `heartbeatService`, add `getRunForThread` using the existing run query mechanism:

```ts
getRunForThread: async (threadId: string) => {
  const rows = await db
    .select()
    .from(heartbeatRuns)
    .where(eq(heartbeatRuns.threadId, threadId))
    .limit(1);
  return rows[0] ?? null;
},
```

(Add this to the `return { ... }` object at the end of `heartbeatService`.)

- [ ] **Step 9: Verify TypeScript compiles**

```bash
cd /Users/zachrizzo/Desktop/programming/blip
npx tsc --noEmit -p server/tsconfig.json 2>&1 | head -40
```

Expected: no new errors.

- [ ] **Step 10: Commit**

```bash
git add server/src/services/heartbeat.ts
git commit -m "feat: heartbeat runs auto-create chat thread on enqueue"
```

---

### Task 5: Routes — invoke returns threadId; thread messages pass threadId to wakeup; new thread run endpoints

**Files:**
- Modify: `server/src/routes/agents.ts`

- [ ] **Step 1: Update `POST /agents/:id/heartbeat/invoke` to return threadId**

Find the invoke route (line ~2047). The current code calls `heartbeat.invoke(...)` and returns `run`. After the run is created, look up its `threadId` from the run record. The `heartbeatRuns` schema now has `threadId`, so the returned `run` object will include `threadId` automatically (since Drizzle `returning()` returns all columns).

Change the response from:
```ts
res.status(202).json(run);
```
to:
```ts
res.status(202).json({ ...run, threadId: run.threadId });
```

(This is a no-op if `threadId` is already on the run object — it makes the contract explicit.)

- [ ] **Step 2: Update `POST /agent-threads/:threadId/messages` to pass threadId to wakeup**

Find the wakeup call inside `POST /agent-threads/:threadId/messages` (around line 2590). The current `heartbeat.wakeup(thread.agentId, { ... })` call does not pass `threadId`. Update the options to include it:

```ts
await heartbeat.wakeup(thread.agentId, {
  source: "on_demand",
  triggerDetail: "manual",
  reason: `User message: ${messageBody.trim().slice(0, 100)}`,
  threadId,    // ← add this so the new run attaches to this thread
  payload: {
    userMessage: messageBody.trim(),
    threadId,
    issueId: thread.issueId,
    ...(lastRun ? { resumeFromRunId: lastRun.id } : {}),
  },
  requestedByActorType: "user",
  requestedByActorId: actor.actorId ?? undefined,
});
```

- [ ] **Step 3: Add `GET /agent-threads/:threadId/run` endpoint**

After the `POST /agent-threads/:threadId/messages` route (around line 2608), add:

```ts
/** Get the run associated with a thread (null if none) */
router.get("/agent-threads/:threadId/run", async (req, res) => {
  const threadId = req.params.threadId as string;
  const thread = await messages.getThread(threadId);
  if (!thread) { res.status(404).json({ error: "Thread not found" }); return; }
  assertCompanyAccess(req, thread.companyId);
  const run = await heartbeat.getRunForThread(threadId);
  res.json(run ?? null);
});
```

- [ ] **Step 4: Add `GET /agent-threads/:threadId/run-events` endpoint**

```ts
/** Get run events (transcript) for the run associated with a thread */
router.get("/agent-threads/:threadId/run-events", async (req, res) => {
  const threadId = req.params.threadId as string;
  const thread = await messages.getThread(threadId);
  if (!thread) { res.status(404).json({ error: "Thread not found" }); return; }
  assertCompanyAccess(req, thread.companyId);
  const run = await heartbeat.getRunForThread(threadId);
  if (!run) { res.json([]); return; }
  const events = await heartbeat.getRunEvents(run.id);
  res.json(events);
});
```

Note: verify the name `heartbeat.getRunEvents` by checking what method the existing `GET /heartbeat-runs/:runId/events` route calls.

```bash
grep -n "getRunEvents\|run-events\|runEvents" /Users/zachrizzo/Desktop/programming/blip/server/src/routes/agents.ts | head -10
```

Use the same method name you find there.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/zachrizzo/Desktop/programming/blip
npx tsc --noEmit -p server/tsconfig.json 2>&1 | head -40
```

Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/agents.ts
git commit -m "feat: invoke returns threadId; thread messages trigger wakeup with threadId; add thread run endpoints"
```

---

### Task 6: UI API client — update `ChatThread` type; add thread run API calls

**Files:**
- Modify: `ui/src/api/agents.ts`

- [ ] **Step 1: Update `ChatThread` interface**

Find the `ChatThread` interface (around line 274) and add run fields:

```ts
export interface ChatThread {
  id: string;
  companyId: string;
  agentId: string;
  issueId: string | null;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  // Run fields — null if thread has no run
  runId: string | null;
  runStatus: string | null;
  runStartedAt: string | null;
  runFinishedAt: string | null;
}
```

- [ ] **Step 2: Update `invoke` return type**

Find `invoke` in `agentsApi` (line ~188):

```ts
invoke: (id: string, companyId?: string) => api.post<HeartbeatRun>(agentPath(id, companyId, "/heartbeat/invoke"), {}),
```

Change to:

```ts
invoke: (id: string, companyId?: string) =>
  api.post<HeartbeatRun & { threadId: string }>(agentPath(id, companyId, "/heartbeat/invoke"), {}),
```

- [ ] **Step 3: Add `getThreadRun` and `getThreadRunEvents` to `agentsApi`**

After the existing `sendThreadMessage` entry in `agentsApi`, add:

```ts
getThreadRun: (threadId: string) =>
  api.get<import("@paperclipai/shared").HeartbeatRun | null>(`/agent-threads/${threadId}/run`),
getThreadRunEvents: (threadId: string) =>
  api.get<unknown[]>(`/agent-threads/${threadId}/run-events`),
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/zachrizzo/Desktop/programming/blip
npx tsc --noEmit -p ui/tsconfig.json 2>&1 | head -40
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add ui/src/api/agents.ts
git commit -m "feat: update ChatThread type with run fields; add getThreadRun/getThreadRunEvents"
```

---

### Task 7: UI — AgentDetail: navigate to chat tab after invoke

**Files:**
- Modify: `ui/src/pages/AgentDetail.tsx`

- [ ] **Step 1: Find the invoke navigation (line ~696)**

The current code navigates to the runs tab:

```ts
if (action === "invoke" && data && typeof data === "object" && "id" in data) {
  navigate(`/agents/${canonicalAgentRef}/runs/${(data as HeartbeatRun).id}`);
}
```

- [ ] **Step 2: Update to navigate to chat tab with the thread selected**

Replace with:

```ts
if (action === "invoke" && data && typeof data === "object" && "id" in data) {
  const run = data as HeartbeatRun & { threadId?: string };
  if (run.threadId) {
    navigate(`/agents/${canonicalAgentRef}?tab=chat&threadId=${run.threadId}`);
  } else {
    navigate(`/agents/${canonicalAgentRef}/runs/${run.id}`);
  }
}
```

- [ ] **Step 3: Find where `activeView` is set from URL params**

```bash
grep -n "activeView\|tab\|searchParams\|useSearchParams" /Users/zachrizzo/Desktop/programming/blip/ui/src/pages/AgentDetail.tsx | head -20
```

Note how the URL `?tab=chat` is (or isn't) already handled. If `tab` param drives `activeView`, the Chat tab will auto-open. If not, also set `setActiveView("chat")` after navigation.

- [ ] **Step 4: Pass `threadId` from URL to `AgentChatView`**

Find where `AgentChatView` is rendered in `AgentDetail.tsx`. It currently receives `agentId`, `agentName`, `companyId`. Add `initialThreadId`:

```tsx
{activeView === "chat" && agent && (
  <AgentChatView
    agentId={agent.id}
    agentName={agent.name}
    companyId={resolvedCompanyId ?? undefined}
    initialThreadId={searchParams.get("threadId") ?? undefined}
  />
)}
```

(Read the full render block first to understand the exact JSX structure before editing.)

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/zachrizzo/Desktop/programming/blip
npx tsc --noEmit -p ui/tsconfig.json 2>&1 | head -40
```

Expected: no new errors (there may be a prop mismatch warning for `initialThreadId` — that's fine, Task 8 adds it).

- [ ] **Step 6: Commit**

```bash
git add ui/src/pages/AgentDetail.tsx
git commit -m "feat: invoke navigates to chat tab with thread selected"
```

---

### Task 8: UI — `AgentChatView`: run status badge in sidebar + thread-specific live transcript

**Files:**
- Modify: `ui/src/components/AgentChatView.tsx`

- [ ] **Step 1: Add `initialThreadId` prop**

Update the `AgentChatViewProps` interface:

```ts
interface AgentChatViewProps {
  agentId: string;
  agentName: string;
  companyId?: string;
  initialThreadId?: string;
}
```

Update the function signature and use it in the auto-select effect:

```ts
export function AgentChatView({ agentId, agentName, companyId, initialThreadId }: AgentChatViewProps) {
  const [activeThreadId, setActiveThreadId] = useState<string | null>(initialThreadId ?? null);
  // ...

  // Auto-select initialThreadId if provided, else most recent thread
  useEffect(() => {
    if (!activeThreadId && threads && threads.length > 0) {
      setActiveThreadId(initialThreadId ?? threads[0].id);
    }
  }, [threads, activeThreadId, initialThreadId]);
```

- [ ] **Step 2: Add run status badge to thread list items**

Find the thread list item render (around line 108, the `.map((thread) => ...)` block). After the `<span>` with the thread title, add a run status indicator:

```tsx
{/* Run status badge */}
{thread.runId && (
  <span className={cn(
    "ml-auto h-2 w-2 rounded-full shrink-0",
    thread.runStatus === "running" || thread.runStatus === "queued"
      ? "bg-cyan-400 animate-pulse"
      : thread.runStatus === "succeeded"
        ? "bg-green-500/60"
        : thread.runStatus === "failed" || thread.runStatus === "timed_out"
          ? "bg-red-500/60"
          : "bg-muted-foreground/20",
  )} />
)}
```

Place this badge inside the `flex items-center gap-1.5` div, after the title span.

- [ ] **Step 3: Pass thread's runId to `ThreadChat`**

The `ThreadChat` component currently receives `thread: ChatThread`. Since `ChatThread` now has `runId`, `runStatus` etc, no prop change is needed. But update the usage of live runs inside `ThreadChat`:

Find the section in `ThreadChat` that fetches `liveRuns` (around line 224):

```ts
const { data: liveRuns } = useQuery({
  queryKey: [...queryKeys.liveRuns(companyId!), "chat", agentId],
  queryFn: () => heartbeatsApi.liveRunsForCompany(companyId!),
  enabled: !!companyId,
  refetchInterval: 2000,
});
const agentLiveRuns = useMemo(
  () => (liveRuns ?? []).filter((r) => r.agentId === agentId && (r.status === "running" || r.status === "queued")),
  [liveRuns, agentId],
);
```

Replace with a filter that only shows the live run for THIS thread:

```ts
const { data: liveRuns } = useQuery({
  queryKey: [...queryKeys.liveRuns(companyId!), "chat", agentId],
  queryFn: () => heartbeatsApi.liveRunsForCompany(companyId!),
  enabled: !!companyId,
  refetchInterval: 2000,
});
const agentLiveRuns = useMemo(
  () => (liveRuns ?? []).filter(
    (r) => r.agentId === agentId &&
      (r.status === "running" || r.status === "queued") &&
      // Only show the live run that belongs to this thread
      (thread.runId ? r.id === thread.runId : true),
  ),
  [liveRuns, agentId, thread.runId],
);
```

- [ ] **Step 4: Show completed run transcript inline (always expanded)**

Find the `RunTranscriptInline` usage in `ChatBubble` (around line 409). Currently it's hidden behind a "show work" toggle. Keep that behavior for individual messages.

But also add a full-thread transcript section in `ThreadChat`, below the messages list and above the live stream bubbles. After the `{sorted.map(...)}` block and before `{isAgentRunning && agentLiveRuns.map(...)}`:

```tsx
{/* Completed run transcript — shown when thread has a finished run */}
{thread.runId && !isAgentRunning && (
  <ThreadRunTranscript runId={thread.runId} agentId={agentId} companyId={thread.companyId} />
)}
```

- [ ] **Step 5: Add `ThreadRunTranscript` component**

Add this component at the bottom of `AgentChatView.tsx`, after the `LiveStreamBubble` component:

```tsx
/** Full run transcript shown inline when a thread's run is complete */
function ThreadRunTranscript({ runId, agentId, companyId }: { runId: string; agentId?: string; companyId: string }) {
  const { data: run } = useQuery({
    queryKey: ["runDetail", runId],
    queryFn: () => heartbeatsApi.get(runId),
    staleTime: 30_000,
  });

  const { data: agent } = useQuery({
    queryKey: queryKeys.agents.detail(agentId ?? ""),
    queryFn: () => agentsApi.get(agentId ?? ""),
    enabled: !!agentId,
    staleTime: 60_000,
  });

  const runs = useMemo(() => run ? [{
    id: run.id,
    status: run.status,
    invocationSource: run.invocationSource ?? "unknown",
    triggerDetail: run.triggerDetail ?? null,
    startedAt: run.startedAt as unknown as string | null,
    finishedAt: run.finishedAt as unknown as string | null,
    createdAt: run.createdAt as unknown as string,
    agentId: run.agentId,
    agentName: agent?.name ?? "",
    adapterType: agent?.adapterType ?? "",
  } satisfies LiveRunForIssue] : [], [run, agent]);

  const { transcriptByRun } = useLiveRunTranscripts({ runs, companyId, maxChunksPerRun: 500 });
  const transcript = transcriptByRun.get(runId) ?? [];

  if (!run || transcript.length === 0) return null;

  // Only show for finished runs
  if (run.status === "queued" || run.status === "running") return null;

  return (
    <div className="mx-4 my-2 rounded-xl border border-border/30 bg-background/50 overflow-hidden">
      <div className="px-3 py-2 border-b border-border/20 flex items-center gap-2">
        {run.status === "succeeded" ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-green-500/60" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-red-500/60" />
        )}
        <span className="text-[11px] font-medium text-muted-foreground/60">
          Run transcript
        </span>
        <span className="text-[10px] text-muted-foreground/40 ml-auto">
          {run.status} · {run.usageJson ? `${((run.usageJson as Record<string, unknown>).inputTokens as number ?? 0).toLocaleString()} tokens` : ""}
        </span>
      </div>
      <div className="max-h-[500px] overflow-y-auto px-3 py-2">
        <RunTranscriptView
          entries={transcript}
          density="compact"
          limit={200}
          streaming={false}
          collapseStdout={false}
          emptyMessage="No transcript data"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd /Users/zachrizzo/Desktop/programming/blip
npx tsc --noEmit -p ui/tsconfig.json 2>&1 | head -40
```

Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add ui/src/components/AgentChatView.tsx
git commit -m "feat: chat view shows run status badge and inline transcript per thread"
```

---

### Task 9: UI — Dashboard run cards link to chat thread

**Files:**
- Modify: `ui/src/components/LiveRunWidget.tsx` (or wherever run cards link to run detail)
- Modify: `ui/src/components/ActiveAgentsPanel.tsx`

- [ ] **Step 1: Find run links in dashboard components**

```bash
grep -n "runs/\${" /Users/zachrizzo/Desktop/programming/blip/ui/src/components/LiveRunWidget.tsx
grep -n "runs/\${" /Users/zachrizzo/Desktop/programming/blip/ui/src/components/ActiveAgentsPanel.tsx
grep -n "runs/\${" /Users/zachrizzo/Desktop/programming/blip/ui/src/pages/Dashboard.tsx
```

Note all locations that link to `/agents/:id/runs/:runId`.

- [ ] **Step 2: Read the run's threadId from the run object**

For each link found, check if the run object has `threadId` (it will after the migration). The `HeartbeatRun` type in `@paperclipai/shared` needs to be updated too. Check:

```bash
grep -n "threadId\|thread_id" /Users/zachrizzo/Desktop/programming/blip/packages/shared/src/types/*.ts 2>/dev/null | head -20
```

If `HeartbeatRun` in shared doesn't have `threadId`, add it:

```ts
// In packages/shared/src/types/heartbeat.ts (or wherever HeartbeatRun is defined)
// Add to the HeartbeatRun interface:
threadId: string;  // always set after migration
```

- [ ] **Step 3: Update run card links**

For each run card link that was `/agents/${agentId}/runs/${run.id}`, change to:

```ts
run.threadId
  ? `/agents/${agentId}?tab=chat&threadId=${run.threadId}`
  : `/agents/${agentId}/runs/${run.id}`
```

Do this for each location found in Step 1.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/zachrizzo/Desktop/programming/blip
npx tsc --noEmit -p ui/tsconfig.json 2>&1 | head -40
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add ui/src/components/LiveRunWidget.tsx ui/src/components/ActiveAgentsPanel.tsx ui/src/pages/Dashboard.tsx packages/shared/src/types/
git commit -m "feat: dashboard run cards link to chat thread"
```

---

### Task 10: End-to-end smoke test

- [ ] **Step 1: Start the dev server**

```bash
cd /Users/zachrizzo/Desktop/programming/blip
# Check the dev command
cat package.json | grep -A10 '"scripts"'
```

Run the dev server as shown.

- [ ] **Step 2: Invoke an agent run and verify a thread is created**

Navigate to an agent detail page → click "Run Heartbeat" → verify:
1. The response includes `threadId`
2. The page navigates to `?tab=chat&threadId=...`
3. The Chat tab opens with the new thread selected
4. The thread shows the run status badge (animated dot while running)

- [ ] **Step 3: Verify thread transcript appears after run completes**

Wait for the run to finish → verify:
1. The animated badge turns green
2. `ThreadRunTranscript` renders below the messages with the full run output

- [ ] **Step 4: Verify pure chat still works**

Click "New Chat" in the sidebar → send a message without invoking a run → verify:
1. Thread is created with title "New Chat"
2. No run badge shown (no `runId`)
3. Message appears as pending

- [ ] **Step 5: Verify timer/automation runs create threads**

Check the DB or API to confirm that timer-triggered runs have `threadId` set.

---

## Self-Review

**Spec coverage check:**
- ✅ Every run auto-creates a thread (`enqueueWakeup` creates thread before inserting run)
- ✅ Threads can exist without runs (no schema constraint on threads)
- ✅ Runs always have a thread (`threadId NOT NULL` on `heartbeat_runs`)
- ✅ Thread title = issue name if issueId, else source + timestamp
- ✅ Chat tab shows all threads with run status badge
- ✅ Full transcript inline (ThreadRunTranscript component)
- ✅ Works from dashboard (run card links to chat tab)
- ✅ Runs tab unchanged
- ✅ User can message without a run (thread messages flow unchanged)
- ✅ Migration backfills existing runs

**Type consistency check:**
- `getRunForThread` returns `typeof heartbeatRuns.$inferSelect | null` — consistent with how other run queries work
- `listThreads` returns `(AgentChatThread & { runId, runStatus, runStartedAt, runFinishedAt })[]` — shape matches new `ChatThread` interface in UI
- `threadId` on `WakeupOptions` is `string | undefined` — consistent with how the `invoke` route creates thread first and passes the id
