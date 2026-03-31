import type {
  Agent,
  AgentDetail,
  AgentInstructionsBundle,
  AgentInstructionsFileDetail,
  AgentSkillSnapshot,
  AdapterEnvironmentTestResult,
  AgentKeyCreated,
  AgentRuntimeState,
  AgentTaskSession,
  HeartbeatRun,
  Approval,
  AgentConfigRevision,
} from "@paperclipai/shared";
import { isUuidLike, normalizeAgentUrlKey } from "@paperclipai/shared";
import { ApiError, api } from "./client";

export interface AgentKey {
  id: string;
  name: string;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface AdapterModel {
  id: string;
  label: string;
  contextWindow?: number;
}

export interface DetectedAdapterModel {
  model: string;
  provider: string;
  source: string;
}

export interface ClaudeLoginResult {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  loginUrl: string | null;
  stdout: string;
  stderr: string;
}

export interface OrgNode {
  id: string;
  name: string;
  role: string;
  status: string;
  reports: OrgNode[];
}

export interface AgentHireResponse {
  agent: Agent;
  approval: Approval | null;
}

export interface AgentPermissionUpdate {
  canCreateAgents: boolean;
  canAssignTasks: boolean;
}

function withCompanyScope(path: string, companyId?: string) {
  if (!companyId) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}companyId=${encodeURIComponent(companyId)}`;
}

function agentPath(id: string, companyId?: string, suffix = "") {
  return withCompanyScope(`/agents/${encodeURIComponent(id)}${suffix}`, companyId);
}

export const agentsApi = {
  list: (companyId: string) => api.get<Agent[]>(`/companies/${companyId}/agents`),
  org: (companyId: string) => api.get<OrgNode[]>(`/companies/${companyId}/org`),
  listConfigurations: (companyId: string) =>
    api.get<Record<string, unknown>[]>(`/companies/${companyId}/agent-configurations`),
  get: async (id: string, companyId?: string) => {
    try {
      return await api.get<AgentDetail>(agentPath(id, companyId));
    } catch (error) {
      // Backward-compat fallback: if backend shortname lookup reports ambiguity,
      // resolve using company agent list while ignoring terminated agents.
      if (
        !(error instanceof ApiError) ||
        error.status !== 409 ||
        !companyId ||
        isUuidLike(id)
      ) {
        throw error;
      }

      const urlKey = normalizeAgentUrlKey(id);
      if (!urlKey) throw error;

      const agents = await api.get<Agent[]>(`/companies/${companyId}/agents`);
      const matches = agents.filter(
        (agent) => agent.status !== "terminated" && normalizeAgentUrlKey(agent.urlKey) === urlKey,
      );
      if (matches.length !== 1) throw error;
      return api.get<AgentDetail>(agentPath(matches[0]!.id, companyId));
    }
  },
  getConfiguration: (id: string, companyId?: string) =>
    api.get<Record<string, unknown>>(agentPath(id, companyId, "/configuration")),
  listConfigRevisions: (id: string, companyId?: string) =>
    api.get<AgentConfigRevision[]>(agentPath(id, companyId, "/config-revisions")),
  getConfigRevision: (id: string, revisionId: string, companyId?: string) =>
    api.get<AgentConfigRevision>(agentPath(id, companyId, `/config-revisions/${revisionId}`)),
  rollbackConfigRevision: (id: string, revisionId: string, companyId?: string) =>
    api.post<Agent>(agentPath(id, companyId, `/config-revisions/${revisionId}/rollback`), {}),
  create: (companyId: string, data: Record<string, unknown>) =>
    api.post<Agent>(`/companies/${companyId}/agents`, data),
  hire: (companyId: string, data: Record<string, unknown>) =>
    api.post<AgentHireResponse>(`/companies/${companyId}/agent-hires`, data),
  update: (id: string, data: Record<string, unknown>, companyId?: string) =>
    api.patch<Agent>(agentPath(id, companyId), data),
  updatePermissions: (id: string, data: AgentPermissionUpdate, companyId?: string) =>
    api.patch<AgentDetail>(agentPath(id, companyId, "/permissions"), data),
  instructionsBundle: (id: string, companyId?: string) =>
    api.get<AgentInstructionsBundle>(agentPath(id, companyId, "/instructions-bundle")),
  updateInstructionsBundle: (
    id: string,
    data: {
      mode?: "managed" | "external";
      rootPath?: string | null;
      entryFile?: string;
      clearLegacyPromptTemplate?: boolean;
    },
    companyId?: string,
  ) => api.patch<AgentInstructionsBundle>(agentPath(id, companyId, "/instructions-bundle"), data),
  instructionsFile: (id: string, relativePath: string, companyId?: string) =>
    api.get<AgentInstructionsFileDetail>(
      agentPath(id, companyId, `/instructions-bundle/file?path=${encodeURIComponent(relativePath)}`),
    ),
  saveInstructionsFile: (
    id: string,
    data: { path: string; content: string; clearLegacyPromptTemplate?: boolean },
    companyId?: string,
  ) => api.put<AgentInstructionsFileDetail>(agentPath(id, companyId, "/instructions-bundle/file"), data),
  deleteInstructionsFile: (id: string, relativePath: string, companyId?: string) =>
    api.delete<AgentInstructionsBundle>(
      agentPath(id, companyId, `/instructions-bundle/file?path=${encodeURIComponent(relativePath)}`),
    ),
  pause: (id: string, companyId?: string) => api.post<Agent>(agentPath(id, companyId, "/pause"), {}),
  resume: (id: string, companyId?: string) => api.post<Agent>(agentPath(id, companyId, "/resume"), {}),
  terminate: (id: string, companyId?: string) => api.post<Agent>(agentPath(id, companyId, "/terminate"), {}),
  pauseAll: (companyId: string) =>
    api.post<{ count: number }>(`/companies/${encodeURIComponent(companyId)}/agents/pause-all`, {}),
  resumeAll: (companyId: string) =>
    api.post<{ count: number }>(`/companies/${encodeURIComponent(companyId)}/agents/resume-all`, {}),
  stopAll: (companyId: string) =>
    api.post<{ count: number }>(`/companies/${encodeURIComponent(companyId)}/agents/stop-all`, {}),
  remove: (id: string, companyId?: string) => api.delete<{ ok: true }>(agentPath(id, companyId)),
  listKeys: (id: string, companyId?: string) => api.get<AgentKey[]>(agentPath(id, companyId, "/keys")),
  skills: (id: string, companyId?: string) =>
    api.get<AgentSkillSnapshot>(agentPath(id, companyId, "/skills")),
  syncSkills: (id: string, desiredSkills: string[], companyId?: string) =>
    api.post<AgentSkillSnapshot>(agentPath(id, companyId, "/skills/sync"), { desiredSkills }),
  createKey: (id: string, name: string, companyId?: string) =>
    api.post<AgentKeyCreated>(agentPath(id, companyId, "/keys"), { name }),
  revokeKey: (agentId: string, keyId: string, companyId?: string) =>
    api.delete<{ ok: true }>(agentPath(agentId, companyId, `/keys/${encodeURIComponent(keyId)}`)),
  runtimeState: (id: string, companyId?: string) =>
    api.get<AgentRuntimeState>(agentPath(id, companyId, "/runtime-state")),
  taskSessions: (id: string, companyId?: string) =>
    api.get<AgentTaskSession[]>(agentPath(id, companyId, "/task-sessions")),
  resetSession: (id: string, taskKey?: string | null, companyId?: string) =>
    api.post<void>(agentPath(id, companyId, "/runtime-state/reset-session"), { taskKey: taskKey ?? null }),
  adapterModels: (companyId: string, type: string) =>
    api.get<AdapterModel[]>(
      `/companies/${encodeURIComponent(companyId)}/adapters/${encodeURIComponent(type)}/models`,
    ),
  detectModel: (companyId: string, type: string) =>
    api.get<DetectedAdapterModel | null>(
      `/companies/${encodeURIComponent(companyId)}/adapters/${encodeURIComponent(type)}/detect-model`,
    ),
  testEnvironment: (
    companyId: string,
    type: string,
    data: { adapterConfig: Record<string, unknown> },
  ) =>
    api.post<AdapterEnvironmentTestResult>(
      `/companies/${companyId}/adapters/${type}/test-environment`,
      data,
    ),
  invoke: (id: string, companyId?: string) => api.post<HeartbeatRun & { threadId: string }>(agentPath(id, companyId, "/heartbeat/invoke"), {}),
  wakeup: (
    id: string,
    data: {
      source?: "timer" | "assignment" | "on_demand" | "automation";
      triggerDetail?: "manual" | "ping" | "callback" | "system";
      reason?: string | null;
      payload?: Record<string, unknown> | null;
      idempotencyKey?: string | null;
    },
    companyId?: string,
  ) => api.post<HeartbeatRun | { status: "skipped" }>(agentPath(id, companyId, "/wakeup"), data),
  loginWithClaude: (id: string, companyId?: string) =>
    api.post<ClaudeLoginResult>(agentPath(id, companyId, "/claude-login"), {}),
  availableSkills: () =>
    api.get<{ skills: AvailableSkill[] }>("/skills/available"),

  // ─── Agent Messages ─────────────────────────────────────────────────
  sendRunMessage: (runId: string, body: string) =>
    api.post<AgentMessage>(`/heartbeat-runs/${runId}/messages`, { body }),
  getRunMessages: (runId: string) =>
    api.get<AgentMessage[]>(`/heartbeat-runs/${runId}/messages`),
  sendAgentMessage: (agentId: string, body: string, issueId?: string) =>
    api.post<AgentMessage>(agentPath(agentId, undefined, "/messages"), { body, issueId }),
  getAgentMessages: (agentId: string, limit = 50) =>
    api.get<AgentMessage[]>(agentPath(agentId, undefined, `/messages?limit=${limit}`)),

  // ─── Chat Threads ───────────────────────────────────────────────────
  getThreads: (agentId: string) =>
    api.get<ChatThread[]>(agentPath(agentId, undefined, "/threads")),
  createThread: (agentId: string, data: { title?: string; issueId?: string }) =>
    api.post<ChatThread>(agentPath(agentId, undefined, "/threads"), data),
  getThreadMessages: (threadId: string) =>
    api.get<AgentMessage[]>(`/agent-threads/${threadId}/messages`),
  sendThreadMessage: (threadId: string, body: string) =>
    api.post<AgentMessage>(`/agent-threads/${threadId}/messages`, { body }),
  sendThreadSystemMessage: (threadId: string, body: string) =>
    api.post<AgentMessage>(`/agent-threads/${threadId}/system-message`, { body }),
  getThreadRun: (threadId: string) =>
    api.get<HeartbeatRun | null>(`/agent-threads/${threadId}/run`),
  getThreadRunEvents: (threadId: string, afterSeq = 0) =>
    api.get<unknown[]>(`/agent-threads/${threadId}/run-events?afterSeq=${afterSeq}`),

  // ─── Blocklist Rules ────────────────────────────────────────────────
  getBlocklist: (agentId: string) =>
    api.get<BlocklistRule[]>(agentPath(agentId, undefined, "/blocklist")),
  createBlocklistRule: (agentId: string, data: CreateBlocklistRuleInput) =>
    api.post<BlocklistRule>(agentPath(agentId, undefined, "/blocklist"), data),
  getCompanyBlocklist: (companyId: string) =>
    api.get<BlocklistRule[]>(`/companies/${companyId}/blocklist`),
  createCompanyBlocklistRule: (companyId: string, data: CreateBlocklistRuleInput) =>
    api.post<BlocklistRule>(`/companies/${companyId}/blocklist`, data),
  updateBlocklistRule: (ruleId: string, data: Partial<BlocklistRule>) =>
    api.put<BlocklistRule>(`/blocklist-rules/${ruleId}`, data),
  deleteBlocklistRule: (ruleId: string) =>
    api.delete(`/blocklist-rules/${ruleId}`),
};

export interface AvailableSkill {
  name: string;
  description: string;
  isPaperclipManaged: boolean;
}

export interface AgentMessage {
  id: string;
  companyId: string;
  agentId: string;
  runId: string | null;
  issueId: string | null;
  senderType: "user" | "agent" | "system";
  senderId: string | null;
  body: string;
  status: "pending" | "delivered";
  deliveredInRunId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BlocklistRule {
  id: string;
  companyId: string;
  agentId: string | null;
  ruleType: "file" | "command" | "tool" | "custom";
  pattern: string;
  description: string | null;
  enforcement: "block" | "warn";
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChatThread {
  id: string;
  companyId: string;
  agentId: string;
  issueId: string | null;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  // Run fields — null if thread has no associated run
  runId: string | null;
  runStatus: string | null;
  runStartedAt: string | null;
  runFinishedAt: string | null;
}

export interface CreateBlocklistRuleInput {
  ruleType: string;
  pattern: string;
  description?: string;
  enforcement?: string;
}
