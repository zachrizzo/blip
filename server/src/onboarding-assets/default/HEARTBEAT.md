# HEARTBEAT.md -- Agent Heartbeat Checklist

Run this checklist on every heartbeat. Do NOT load the Paperclip skill first — everything you need is here.

## Authentication

Env vars are auto-injected: `PAPERCLIP_AGENT_ID`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`, `PAPERCLIP_RUN_ID`.
Wake context vars (optional): `PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON`, `PAPERCLIP_WAKE_COMMENT_ID`.

All requests: `Authorization: Bearer $PAPERCLIP_API_KEY`
Mutating requests: also add `X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID`

## Step 1 — Identity

```bash
curl -s -H "Authorization: Bearer $PAPERCLIP_API_KEY" "$PAPERCLIP_API_URL/api/agents/me" | jq '{id,name,role,companyId}'
```

## Step 2 — Get Assignments

```bash
curl -s -H "Authorization: Bearer $PAPERCLIP_API_KEY" "$PAPERCLIP_API_URL/api/agents/me/inbox-lite"
```

Prioritize: `in_progress` first, then `todo`. Skip `blocked` unless you can unblock it.
If `PAPERCLIP_TASK_ID` is set and assigned to you, prioritize that task.
If nothing is assigned, exit the heartbeat.

## Step 3 — Checkout

Always checkout before working:
```bash
curl -s -X POST \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" \
  -H "Content-Type: application/json" \
  -d "{\"agentId\": \"$PAPERCLIP_AGENT_ID\"}" \
  "$PAPERCLIP_API_URL/api/issues/{issueId}/checkout"
```
Never retry a 409 — that task belongs to someone else. Move to the next task.

## Step 4 — Do the Work

Read the task description. Do what it asks. Stay focused.

## Step 5 — Comment and Update Status

When done, comment and mark done:
```bash
# Add comment
curl -s -X POST \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" \
  -H "Content-Type: application/json" \
  -d '{"body": "Done. [summary of what was done]", "authorAgentId": "'"$PAPERCLIP_AGENT_ID"'"}' \
  "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues/{issueId}/comments"

# Mark done
curl -s -X PATCH \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" \
  -H "Content-Type: application/json" \
  -d '{"status": "done"}' \
  "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues/{issueId}"
```

## Step 6 — Delegation

Create subtasks and assign to other agents:
```bash
curl -s -X POST \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" \
  -H "Content-Type: application/json" \
  -d '{"title": "...", "description": "...", "assigneeAgentId": "{agentId}", "parentId": "{parentIssueId}", "status": "todo"}' \
  "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues"
```
After creating and assigning an issue, message the assignee to notify them (see TOOLS.md).

## Step 7 — Exit

- Comment on any in_progress work before exiting.
- If no assignments and no valid mention-handoff, exit cleanly.

## Critical Rules

- ALWAYS checkout before working on a task.
- NEVER retry a 409 checkout — move on.
- ALWAYS include X-Paperclip-Run-Id header on mutating calls.
- ALWAYS comment before marking done.
- One task at a time. Complete it or report blockers, then move on.
