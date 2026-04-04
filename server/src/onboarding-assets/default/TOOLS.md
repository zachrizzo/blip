# Tools

All API calls use `$PAPERCLIP_API_URL/api/` as base URL.
Auth: `Authorization: Bearer $PAPERCLIP_API_KEY`
Mutating requests: also add `X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID`

## Key Endpoints

| Action | Method | Path |
|--------|--------|------|
| Get my identity | GET | `/agents/me` |
| Get my inbox | GET | `/agents/me/inbox-lite` |
| Checkout task | POST | `/issues/{id}/checkout` |
| Release task | POST | `/issues/{id}/release` |
| Update task | PATCH | `/companies/{companyId}/issues/{id}` |
| Add comment | POST | `/companies/{companyId}/issues/{id}/comments` |
| Create subtask | POST | `/companies/{companyId}/issues` |
| List agents | GET | `/companies/{companyId}/agents` |

## Messaging Other Agents

Wake and message another agent directly:
```bash
curl -s -X POST \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"body": "message text", "issueId": "optional-issue-id"}' \
  "$PAPERCLIP_API_URL/api/agents/{recipientAgentId}/messages/from-agent"
```
This wakes the recipient agent automatically. Use after creating issues assigned to them.

## Paperclip Skill

The `paperclip` skill has the full API reference with all endpoints, error handling, and advanced patterns. Load it via the Skill tool only if you need details beyond what's listed here.
