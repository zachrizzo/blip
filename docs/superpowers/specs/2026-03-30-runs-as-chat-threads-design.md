# Design: Runs as Chat Threads

**Date:** 2026-03-30
**Status:** Approved

## Summary

Unify agent runs and chat threads so that every run is a thread. Threads are the primary entity. Runs always belong to a thread. Threads can exist without a run (pure messaging). The "Chat" tab becomes the conversational view of all runs and chats together. The "Runs" tab is kept for technical/operational data.

---

## Data Model

### `heartbeat_runs` — add one column

```sql
ALTER TABLE heartbeat_runs
  ADD COLUMN thread_id uuid NOT NULL REFERENCES agent_chat_threads(id);
```

- Every run must belong to a thread. `thread_id` is NOT NULL.
- When a run is invoked standalone (timer, automation, on-demand without context), a thread is auto-created before the run record is inserted.
- When a run is invoked from an existing thread, that thread's id is used.

### `agent_chat_threads` — no schema change

Threads already support title, companyId, agentId, issueId. Title logic:
- If thread has an `issueId` → title = issue identifier + title (existing behavior)
- If thread was created for an on-demand run → title = `"On-demand · Mar 30 2:14pm"`
- If thread was created for a timer/automation run → title = `"Timer · Mar 30 2:14pm"` / `"Automation · Mar 30 2:14pm"`
- If thread was created by a user without a run → title = `"New chat"` (editable)

### `agent_messages` — no change

Messages already have `threadId` (nullable) and `runId` (nullable). In the unified model, messages in a run's thread will have `threadId` = run's thread. Messages sent without triggering a run have `runId = null`.

### `heartbeat_run_events` — no change

Events still belong to a run via `run_id`. They are surfaced through the thread by looking up the thread's run.

---

## Backend / Invocation Flow

### Auto-thread creation on invoke

`heartbeat.invoke()` is updated to:
1. Accept an optional `threadId` parameter
2. If `threadId` is provided → use it
3. If not → create a new thread with appropriate title, then create the run with that `thread_id`

All existing invoke paths (timer, automation, on-demand) call through this same updated function.

### Message flow

- Messages sent to a thread (with or without a run) → stored with `threadId`, `runId = null` until delivered
- When a run processes messages, `runId` is set on the message (`deliveredInRunId`)
- Messages sent directly to a run still work — they pick up the run's `threadId` automatically

---

## API Changes

### Updated endpoints

| Endpoint | Change |
|----------|--------|
| `POST /agents/:id/heartbeat/invoke` | Returns `{ runId, threadId }` — threadId is always present |
| `GET /agents/:id/threads` | Each thread now includes `runId?`, `runStatus?`, `runStartedAt?`, `runFinishedAt?` from its associated run |

### New endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /agent-threads/:id/run` | Returns the heartbeat run associated with the thread (null if none) |
| `GET /agent-threads/:id/run-events` | Returns `heartbeat_run_events` for the thread's run (for live transcript) |

### Unchanged endpoints

- `POST /agent-threads/:id/messages` — send message to thread
- `GET /agent-threads/:id/messages` — get messages in thread
- `POST /heartbeat-runs/:runId/messages` — still works (resolves thread via run)
- `GET /heartbeat-runs/:runId/events` — still works

---

## UI Changes

### Agent Detail — Chat Tab

The Chat tab (`AgentChatView`) is expanded to be the primary run+conversation interface:

**Left sidebar:**
- Lists all threads ordered by most recent activity
- Each row shows: thread title, run status badge (running / succeeded / failed / — ), relative timestamp
- "New chat" button creates a message-only thread

**Right pane — Thread view:**
- Unified timeline showing interleaved messages and run events, ordered by timestamp
- Run events rendered inline: tool calls, stdout/stderr, status transitions — styled like Claude Code
- Message input at the bottom: sends to thread, optionally triggers a run
- Run metadata bar at top (if run exists): status, duration, cost, invocation source

### Agent Detail — Runs Tab

Unchanged. Still shows the technical list of runs with exit codes, logs, error info. Links to run detail. No conversations surfaced here.

### Dashboard

- Existing run cards on the dashboard link to the thread (open agent chat tab with that thread selected)
- `AgentChatPanel` on run cards sends to the thread via `/agent-threads/:threadId/messages`
- `LiveRunWidget` and `ActiveAgentsPanel` link to thread view

---

## Key Invariants

1. `heartbeat_runs.thread_id` is always set — no run exists without a thread
2. A thread can have 0 or 1 runs (one-to-one, threads don't accumulate multiple runs)
3. Messages always have a `threadId` when created through the thread flow
4. The "Runs" tab and "Chat" tab both remain — different views of overlapping data

---

## Migration

1. Add `thread_id` column as nullable first
2. Backfill: for each existing run, create a thread (`title = invocation source + started_at`, same `companyId`, `agentId`, `issueId`)
3. Set `NOT NULL` constraint after backfill
4. Backfill `threadId` on existing messages where `runId` is set but `threadId` is null (use the run's new thread)
