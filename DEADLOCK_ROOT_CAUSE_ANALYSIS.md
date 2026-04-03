# Paperclip Deadlock Root Cause Analysis - 2026-04-02

## Problem Summary
Recurring circular deadlocks in Paperclip API causing complete service unavailability. Occurs under load when multiple concurrent issue updates happen simultaneously.

## Deadlock Pattern (Observed 2026-04-02 23:00)

```
Process 91512: UPDATE issues (holds lock A)
Process 91516: UPDATE issues (holds lock B) 
Process 12619: UPDATE issues (holds lock C)
Process 12620: UPDATE issues (holds lock D)
Process 12621: UPDATE issues (holds lock E)
Process 95119: INSERT agent_chat_threads (waits for lock, blocked by UPDATE)
Process 95175: INSERT issue_read_states (waits for lock, blocked by UPDATE)
Process 91829: INSERT agent_wakeup_requests (idle in transaction, holding locks)
Process 91828: INSERT agent_wakeup_requests (idle in transaction, holding locks)

Result: 34 blocking relationships forming circular deadlock
```

## Root Causes

### 1. Transaction Scope Issue
**File**: `server/src/services/issues.ts:1177-1208`

The `update()` method wraps issue updates in a transaction:
```typescript
return db.transaction(async (tx) => {
  // ... goal resolution ...
  const updated = await tx.update(issues)
    .set(patch)
    .where(eq(issues.id, id))
    .returning()
  // ... label sync ...
  return enriched;
});
```

This holds row-level locks on issues until the transaction commits.

### 2. Cascading Operations After Update
**File**: `server/src/routes/issues.ts:1153-1174`

After the issue update completes, wakeup operations are triggered:
```typescript
void (async () => {
  if (assigneeChanged && issue.assigneeAgentId) {
    await queueIssueAssignmentWakeup({
      db, heartbeat, issue, ...
    });
  }
  // ... more wakeups ...
})();
```

These operations:
- INSERT into `agent_chat_threads` (foreign key → issues)
- INSERT into `agent_wakeup_requests` (may reference issues/agents)
- INSERT into `issue_read_states` (foreign key → issues)

### 3. Foreign Key Lock Amplification
When `agent_chat_threads` is inserted with `issue_id`, PostgreSQL:
1. Acquires a **shared lock** on the referenced issues row
2. This conflicts with exclusive locks held by concurrent UPDATE operations
3. Creates circular wait patterns

### 4. "Idle in Transaction" Connections
Processes 91828 and 91829 were stuck "idle in transaction":
- Started a transaction
- Inserted into `agent_wakeup_requests`
- Never committed/rolled back
- Held locks blocking all other operations

## Why Previous Fix Was Insufficient

**Commit 9fa561e8** (2026-04-02) removed SELECT query from `getOrCreateThreadForIssue`:
```typescript
// BEFORE: Query issues table during thread creation (DEADLOCK!)
const issue = await db.select().from(issues).where(eq(issues.id, issueId));
const title = issue?.title ?? issueId;

// AFTER: Use provided title or fallback (FIXED)
const title = issueTitle ?? issueId.slice(0, 8);
```

This helped but didn't solve the fundamental problem: **concurrent operations still create circular lock dependencies through foreign keys and row locks**.

## Proposed Solutions

### Option A: Deferred Foreign Key Constraints (Quick Fix)
Make foreign keys `DEFERRABLE INITIALLY DEFERRED`:
```sql
ALTER TABLE agent_chat_threads 
  DROP CONSTRAINT agent_chat_threads_issue_id_fkey,
  ADD CONSTRAINT agent_chat_threads_issue_id_fkey 
    FOREIGN KEY (issue_id) REFERENCES issues(id)
    DEFERRABLE INITIALLY DEFERRED;
```

**Pros**: Minimal code changes, lets transactions acquire locks in any order
**Cons**: Doesn't prevent lock contention, just delays it

### Option B: Advisory Locks (Better)
Replace row locks with PostgreSQL advisory locks for issue operations:
```typescript
async update(id: string, data: ...) {
  return db.transaction(async (tx) => {
    // Acquire advisory lock based on issue ID hash
    const lockId = hashStringToInt64(id);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockId})`);
    
    // Now safe to update - no other transaction has this advisory lock
    const updated = await tx.update(issues)...
  });
}
```

**Pros**: Serializes operations on same issue, prevents deadlocks
**Cons**: Slightly more complex, requires lock ID generation

### Option C: Separate Wakeup Queue (Best Long-term)
Move wakeup operations to a background queue (Redis, pg_notify, etc):
```typescript
// Route handler - just enqueue, don't await
await issueWakeupQueue.enqueue({
  issueId: issue.id,
  agentId: issue.assigneeAgentId,
  reason: 'issue_assigned'
});

// Background worker processes queue
// - No transaction conflicts with API requests
// - Automatic retries on failure
// - Better observability
```

**Pros**: Completely decouples operations, natural retry mechanism
**Cons**: Requires infrastructure (queue system), eventual consistency

### Option D: Batch Wakeup Operations
Accumulate wakeup requests and process them in batches:
```typescript
// Instead of immediate INSERT per wakeup:
for (const wakeup of wakeups) {
  await insertWakeupRequest(wakeup); // Each INSERT can deadlock
}

// Batch insert:
await insertWakeupRequestsBatch(wakeups); // Single INSERT, fewer locks
```

**Pros**: Reduces number of separate INSERTs
**Cons**: Still vulnerable to deadlocks, limited benefit

## Recommended Immediate Action

**Implement Option B (Advisory Locks)**

1. Add advisory lock helper:
```typescript
// server/src/services/issues.ts
function getIssueAdvisoryLockId(issueId: string): number {
  // Use first 8 bytes of UUID as int64
  const hex = issueId.replace(/-/g, '').substring(0, 16);
  return parseInt(hex, 16);
}
```

2. Wrap update operations:
```typescript
return db.transaction(async (tx) => {
  // Serialize access to this specific issue
  const lockId = getIssueAdvisoryLockId(id);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockId})`);
  
  // Rest of update logic...
});
```

3. Add retry logic with exponential backoff for remaining edge cases

## Testing Plan

1. Reproduce deadlock: Run 50 concurrent issue update requests
2. Apply advisory lock fix
3. Verify no deadlocks under same load
4. Monitor: `pg_stat_activity`, `pg_locks`, API latency metrics

## Success Criteria

- [ ] Zero deadlocks under concurrent load (50+ simultaneous updates)
- [ ] API latency P99 < 500ms
- [ ] No "idle in transaction" connections lasting > 5 seconds
- [ ] Clean recovery without manual intervention

---

**Created**: 2026-04-02 23:15  
**Status**: Analysis complete, ready to implement
