# Conversational Company Onboarding — Design Spec

**Date:** 2026-03-30
**Status:** Draft

---

## Context

The current onboarding is a 4-step wizard modal that collects a company name, creates a hardcoded "CEO" agent, lets the user enter an initial task, and launches it. This has several problems:

- Forced CEO role — many users want a manager, analyst, or team lead, not a company CEO
- Almost no company data collected (only name + optional goal string)
- Static wizard can't adapt to the user's actual situation
- No personality, no suggestions, no AI guidance
- Task creation in the wizard is arbitrary and disconnected from real planning

**The new model:** User creates one agent (any role) via a minimal form, then that agent — using a built-in company-setup skill — guides the user through setting up everything else via chat: additional agents, company goals, descriptions, and files. A summary screen at the end shows everything that was created before the user hits Finish.

---

## Architecture

### Route & Shell

New full-screen route outside the sidebar layout:

```
/onboarding/new          → creates company placeholder, redirects to /onboarding/:companyId
/onboarding/:companyId   → 3-stage onboarding page (no sidebar)
```

**Stage progress bar** at top: `[1. Create Agent] → [2. Set Up] → [3. Review]`

**Entry points:**
- `Layout.tsx` auto-trigger (no companies) → `navigate('/onboarding/new')` instead of `openOnboarding()`
- "Add Company" button → same
- Dashboard empty state → same

**Exit:** "Finish" on stage 3 → `navigate('/:companyPrefix/dashboard')`

---

## Stage 1: Create Agent

**Renders:** Company name field (patches placeholder company) + existing `AgentConfigForm` in create mode.

**Changes from current wizard:**
- `role` field: free text, not defaulted to "ceo"
- Environment test button stays (validates adapter before handing to chat)
- No `companyGoal` field (agent collects this in chat)
- No initial task step (agent handles this in chat)
- "Continue" enabled when: company name filled + agent name filled + adapter configured

**Reused as-is:** `AgentConfigForm`, `agentsApi.create()`, `agentsApi.testEnvironment()`, `companiesApi.update()`

---

## Stage 2: Agent-Guided Setup (Chat)

On entering stage 2:
1. Auto-create onboarding thread: `agentsApi.createThread(agentId, { title: "Company Setup" })`
2. Inject a system message via a new backend endpoint `POST /agent-threads/:threadId/system-message` (accepts `body`, writes with `senderType: "system"` — not exposed to the normal user send path)
3. Wake the agent via `agentsApi.wake(agentId, { source: "on_demand", reason: "onboarding" })` so it processes immediately

**System prompt injected into thread:**
```
You are helping set up a new workspace called "{companyName}".
Your role is {agentRole}. Guide the user through:
1. What the workspace/team is for (update company description + goals)
2. What other agents/team members are needed (create them)
3. Any key documents or files to create

Use the available company-setup tools to take actions as the user decides things.
When setup feels complete, let the user know they can continue to review.
```

**Renders:** Full-height `AgentChatView` (reused as-is) for this thread.

**"Continue to Review" button:** Appears in top bar once `companiesApi.get(companyId)` returns `onboardingComplete=true` (polled every 3s, same pattern as message polling). The agent calls `finish_onboarding` skill tool to set this flag. The user can also manually click "Continue" at any time.

---

## Stage 3: Summary & Finish

Read-only overview of everything created during the chat:

- **Company:** name, description, brand color (if set)
- **Goals:** list of created goals (fetched via `goalsApi.list(companyId)`)
- **Agents:** cards showing name, role, adapter (fetched via `agentsApi.list(companyId)`)
- **Files/Docs:** list with links (fetched via `documentsApi.list(companyId)` if documents exist; omitted if none)
- **Chat thread:** collapsed expandable showing the full conversation

**"Finish" button:** navigates to `/:companyPrefix/dashboard`. Marks onboarding complete on the company record.

---

## Backend: Company-Setup Skill

A new built-in skill the agent calls during the onboarding thread. Registered as a system skill available to all agents (not adapter-specific).

**Tools exposed:**

| Tool | Args | Action |
|------|------|--------|
| `update_company` | `description, industry, teamSize, primaryUseCase` | `companiesApi.update()` with enriched fields |
| `create_agent` | `name, role, title, adapterType, adapterConfig` | Creates additional agents under the company |
| `create_goal` | `title, description` | Creates a company goal |
| `create_file` | `name, content, type` | Creates a document/file in the workspace |
| `finish_onboarding` | — | Sets `onboardingComplete = true` on company, signals frontend |

**How the agent calls skills:** Through its normal tool-use mechanism — the agent's system prompt (injected via the system message in the thread) includes the skill tool definitions in JSON schema format. The agent emits tool calls during execution; the adapter runtime intercepts them and routes to the skill handler server-side. Results are returned as tool responses in the conversation.

---

## Data Model Changes

### Company schema additions

```typescript
// packages/db/src/schema/companies.ts
industry: text [nullable]          // e.g. "software", "healthcare"
teamSize: integer [nullable]       // e.g. 5
primaryUseCase: text [nullable]    // free text
onboardingComplete: boolean default false
onboardingThreadId: uuid [nullable] // FK to agent_chat_threads
```

### New migration
`packages/db/src/migrations/0047_company_onboarding_fields.sql`

---

## Key Files to Create / Modify

### New files
- `ui/src/pages/OnboardingPage.tsx` — full-screen 3-stage page
- `ui/src/pages/OnboardingPage.css` (or Tailwind-only)
- `server/src/services/company-setup-skill.ts` — skill handler
- `packages/db/src/migrations/0047_company_onboarding_fields.sql`

### Modified files
- `ui/src/App.tsx` — add `/onboarding/:companyId` route, keep `/onboarding/new` handler
- `ui/src/components/Layout.tsx` — replace `openOnboarding()` with `navigate('/onboarding/new')`
- `ui/src/context/DialogContext.tsx` — update `openOnboarding()` to redirect (or keep for backward compat via dashboard empty state)
- `packages/db/src/schema/companies.ts` — add new fields
- `packages/shared/src/types/company.ts` — add new fields to Company type
- `packages/shared/src/validators/company.ts` — add new fields to update schema
- `server/src/services/companies.ts` — handle new fields
- `server/src/routes/agents.ts` — add system-message endpoint or senderType param

### Reused unchanged
- `ui/src/components/AgentConfigForm.tsx`
- `ui/src/components/AgentChatView.tsx`
- `ui/src/components/AgentChatPanel.tsx`

---

## Verification

1. **Fresh start:** Delete all companies, refresh. Should navigate to `/onboarding/new`, redirect to `/onboarding/:companyId`, show stage 1.
2. **Stage 1:** Fill company name, configure agent (any role), pass env test, click Continue → stage 2.
3. **Stage 2:** Chat thread auto-created, system message visible, agent responds. Ask agent to create another agent, set a goal → actions tracked.
4. **Continue to Review** button appears after actions taken.
5. **Stage 3:** Shows company info, new agents, goals created. "Finish" navigates to dashboard.
6. **Add company:** Clicking "Add Company" from sidebar goes to `/onboarding/new` not the old modal.
7. **DB check:** Company has `onboardingComplete=true`, new fields populated.
