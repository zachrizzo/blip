import type { Db } from "@paperclipai/db";
import { companyService } from "./companies.js";
import { agentService } from "./agents.js";
import { goalService } from "./goals.js";

/**
 * Handles tool calls from the onboarding agent during company setup.
 * These tools are described in the onboarding system prompt and executed
 * via POST /companies/:companyId/onboarding-action.
 */
export function companySetupSkillService(db: Db) {
  const companies = companyService(db);
  const agentSvc = agentService(db);
  const goals = goalService(db);

  return {
    /**
     * Execute a named tool call from the onboarding agent.
     */
    executeAction: async (
      companyId: string,
      tool: string,
      args: Record<string, unknown>,
    ): Promise<{ ok: boolean; result: unknown }> => {
      switch (tool) {
        case "update_company": {
          const updated = await companies.update(companyId, {
            description: args.description as string | undefined,
            industry: args.industry as string | undefined,
            teamSize: typeof args.teamSize === "number" ? args.teamSize : undefined,
            primaryUseCase: args.primaryUseCase as string | undefined,
          });
          return { ok: true, result: updated };
        }

        case "create_agent": {
          // Look up the company + an existing agent to inherit adapter settings
          const company = await companies.getById(companyId);
          const companyAgents = await agentSvc.list(companyId);
          const sourceAgent = companyAgents[0]; // first agent = the onboarding agent

          const newRole = (args.role as string | undefined) ?? "general";
          const newName = args.name as string;

          // Inherit adapter type & config from the source agent (command, model, permissions, etc.)
          const sourceConfig = (sourceAgent?.adapterConfig ?? {}) as Record<string, unknown>;
          const newAdapterConfig: Record<string, unknown> = {
            ...(args.adapterConfig as Record<string, unknown> | undefined) ?? {},
          };
          // Copy key adapter fields if not explicitly provided
          for (const key of ["command", "model", "args", "maxTurns", "dangerouslySkipPermissions", "chrome", "effort", "env", "url"]) {
            if (!(key in newAdapterConfig) && key in sourceConfig) {
              newAdapterConfig[key] = sourceConfig[key];
            }
          }
          // Generate a proper prompt template for the new agent
          newAdapterConfig.promptTemplate = buildAgentPromptTemplate({
            agentName: newName,
            agentRole: newRole,
            companyName: company?.name ?? companyId,
          });

          const created = await agentSvc.create(companyId, {
            name: newName,
            role: newRole,
            title: args.title as string | undefined,
            adapterType: (args.adapterType as string | undefined) ?? sourceAgent?.adapterType ?? "claude_local",
            adapterConfig: newAdapterConfig,
            runtimeConfig: {
              heartbeat: { enabled: true, interval: 3600 },
            },
          });
          return { ok: true, result: created };
        }

        case "create_goal": {
          const created = await goals.create(companyId, {
            title: args.title as string,
            description: args.description as string | undefined,
            level: "company",
            status: "active",
          });
          return { ok: true, result: created };
        }

        case "finish_onboarding": {
          const updated = await companies.update(companyId, {
            onboardingComplete: true,
            onboardingThreadId: args.threadId as string | undefined,
          });
          // Reset the agent's prompt template to the standard heartbeat one
          if (args.agentId) {
            const agent = await agentSvc.getById(args.agentId as string);
            if (agent && agent.companyId === companyId) {
              const cfg = (agent.adapterConfig ?? {}) as Record<string, unknown>;
              await agentSvc.update(args.agentId as string, {
                adapterConfig: {
                  ...cfg,
                  promptTemplate: buildAgentPromptTemplate({
                    agentName: agent.name,
                    agentRole: agent.role ?? "general",
                    companyName: updated?.name ?? companyId,
                  }),
                },
              });
            }
          }
          return { ok: true, result: updated };
        }

        default:
          return { ok: false, result: { error: `Unknown tool: ${tool}` } };
      }
    },
  };
}

/**
 * Generate the prompt template set on the agent itself (stored in adapterConfig.promptTemplate).
 * This is the agent's permanent persona — it guides all of the agent's runs.
 */
export function buildAgentPromptTemplate(opts: {
  agentName: string; agentRole: string; companyName: string;
}): string {
  return `You are ${opts.agentName}, a ${opts.agentRole} at ${opts.companyName}.

Follow the Paperclip heartbeat protocol. Plan before acting, use tools, report results.

Output rules:
- Be terse. No pleasantries, no self-narration, no repeating task descriptions.
- Use structured markdown: headers + bullets, not paragraphs.
- Report only: what changed, what's blocked, what's next.
- Keep status updates under 5 bullets.
- Code comments: explain WHY, not WHAT. Skip obvious ones entirely.
- Never add comments to code you didn't change.`;
}

/**
 * Prompt template used DURING onboarding only.
 * Instructs the agent to respond conversationally and call the setup tools via curl.
 * Replaces the standard heartbeat-protocol template until onboarding is complete.
 * After finish_onboarding is called, the agent's prompt is reset to buildAgentPromptTemplate.
 */
export function buildOnboardingAgentPromptTemplate(opts: {
  agentName: string;
  agentRole: string;
  companyName: string;
  companyId: string;
  agentId: string;
  apiBaseUrl: string;
}): string {
  const { agentName, agentRole, companyName, companyId, agentId, apiBaseUrl } = opts;
  const actionUrl = `${apiBaseUrl}/companies/${companyId}/onboarding-action`;

  return `You are ${agentName}, a ${agentRole} at ${companyName}.

You are currently in ONBOARDING MODE — your primary job right now is to help set up this workspace through friendly, helpful conversation.

## How to behave

When you receive a chat message from the user:
1. Read it carefully and respond in a warm, concise way
2. Take action IMMEDIATELY using the setup tools below (via bash curl) — don't wait
3. Confirm each action: "Done — I've added Alex as an engineer."
4. Ask one follow-up question to keep the setup going

Do NOT just report "no tasks assigned" or "inbox empty" — ALWAYS engage with what the user said.
If you're unsure of something (like a name), suggest a sensible default and confirm.

## Setup Tools

Run these in bash using curl:

\`\`\`bash
curl -s -X POST "${actionUrl}" -H "Content-Type: application/json" -d '{"tool":"<name>","args":{...}}'
\`\`\`

### create_agent — hire / add a team member
Args: { "name": string, "role"?: string, "title"?: string, "adapterType"?: "claude_local" }
Example: {"tool":"create_agent","args":{"name":"Alex","role":"engineer","title":"Senior Engineer","adapterType":"claude_local"}}

### create_goal — add a company goal or objective
Args: { "title": string, "description"?: string }
Example: {"tool":"create_goal","args":{"title":"Launch v1 by Q3","description":"Ship the core product to beta users."}}

### update_company — save workspace details
Args: { "description"?: string, "industry"?: string, "teamSize"?: number, "primaryUseCase"?: string }
Example: {"tool":"update_company","args":{"industry":"fintech","teamSize":8,"primaryUseCase":"Automated compliance reporting"}}

### finish_onboarding — signal that setup is complete
Args: { "agentId": "${agentId}" }
Call this when the user says they're done or setup feels complete.
Example: {"tool":"finish_onboarding","args":{"agentId":"${agentId}"}}

## Quick-reference examples
| User says | Tool to call |
|---|---|
| "I need an engineer" | create_agent { name: "Alex", role: "engineer" } |
| "Hire a designer named Sam" | create_agent { name: "Sam", role: "designer" } |
| "Our goal is to launch by Q3" | create_goal { title: "Launch by Q3" } |
| "We're a 10-person SaaS startup" | update_company { teamSize: 10, industry: "SaaS" } |
| "We're all done" | finish_onboarding { agentId: "${agentId}" } |

Always act immediately, then confirm what you did.

## Conversation History
{{ context.paperclipThreadHistory }}

## New Messages (respond to these)
{{ context.paperclipPendingMessages }}`;
}

/**
 * Build the onboarding system message injected into the setup chat thread.
 * Describes available tools so the agent can configure the workspace via chat.
 */
export function buildOnboardingSystemPrompt(opts: {
  companyName: string;
  agentName: string;
  agentRole: string;
  companyId: string;
  apiBaseUrl: string;
}): string {
  const { companyName, agentName, agentRole, companyId, apiBaseUrl } = opts;
  const actionUrl = `${apiBaseUrl}/companies/${companyId}/onboarding-action`;

  return `You are ${agentName}, a ${agentRole} helping set up a new workspace called "${companyName}".

Your job is to guide the user through setting up their workspace in a friendly, conversational way. Ask questions to understand:
1. What this workspace/team is for (purpose, industry, team size)
2. What other team members or agents are needed
3. Any high-level goals or objectives to track
4. Any specific use cases or priorities

As the user shares information, use the tools below to take action. Don't wait until the end — act incrementally as decisions are made.

When setup feels complete, call finish_onboarding to signal the user can continue.

## Available Tools

Call tools by making a POST request to: ${actionUrl}
Request body: { "tool": "<tool_name>", "args": { ... } }
Include header: Content-Type: application/json

### update_company
Update the workspace description and details.
Args: { description?: string, industry?: string, teamSize?: number, primaryUseCase?: string }

### create_agent
Create a new team member/agent.
Args: { name: string, role?: string, title?: string, adapterType?: string }
Note: role should be a short descriptor like "engineer", "designer", "analyst", "manager"

### create_goal
Create a company-level goal or objective.
Args: { title: string, description?: string }

### finish_onboarding
Signal that setup is complete.
Args: { threadId?: string }

## Style
- Be warm and concise
- Ask one question at a time
- Confirm actions as you take them ("Got it, I've added Sarah as an engineer.")
- Suggest sensible defaults ("Most teams start with a general engineer role — want me to create one?")
- If unsure, ask before acting`;
}
