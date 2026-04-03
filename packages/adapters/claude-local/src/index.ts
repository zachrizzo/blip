export const type = "claude_local";
export const label = "Claude Code (local)";

export const models = [
  { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4-6", label: "Claude Haiku 4.6" },
  { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
];

/**
 * Bedrock cross-region inference profile model IDs.
 * Short alias format (e.g. "us.anthropic.claude-sonnet-4-6") is used for 4.x
 * models since Bedrock exposes them without version suffixes in the profile ID.
 * Full version IDs are used for 3.x/4.5 models where the exact suffix is known.
 */
export const bedrockModels = [
  // Claude 4.6 — US cross-region (short alias, as used by Claude Code CLI)
  { id: "us.anthropic.claude-opus-4-6", label: "Claude Opus 4.6 (Bedrock US)" },
  { id: "us.anthropic.claude-sonnet-4-6", label: "Claude Sonnet 4.6 (Bedrock US)" },
  // Claude 4.5 — US cross-region (full version IDs, confirmed in use)
  { id: "us.anthropic.claude-sonnet-4-5-20250929-v1:0", label: "Claude Sonnet 4.5 (Bedrock US)" },
  { id: "us.anthropic.claude-haiku-4-5-20251001-v1:0", label: "Claude Haiku 4.5 (Bedrock US)" },
  // Claude 4.6 — Global cross-region
  { id: "global.anthropic.claude-opus-4-6", label: "Claude Opus 4.6 (Bedrock Global)" },
  { id: "global.anthropic.claude-sonnet-4-6", label: "Claude Sonnet 4.6 (Bedrock Global)" },
  // Claude 4.5 — Global cross-region (full version IDs, confirmed in use)
  { id: "global.anthropic.claude-sonnet-4-5-20250929-v1:0", label: "Claude Sonnet 4.5 (Bedrock Global)" },
  { id: "global.anthropic.claude-haiku-4-5-20251001-v1:0", label: "Claude Haiku 4.5 (Bedrock Global)" },
  // EU cross-region
  { id: "eu.anthropic.claude-sonnet-4-5-20250929-v1:0", label: "Claude Sonnet 4.5 (Bedrock EU)" },
  { id: "eu.anthropic.claude-haiku-4-5-20251001-v1:0", label: "Claude Haiku 4.5 (Bedrock EU)" },
];

export const agentConfigurationDoc = `# claude_local agent configuration

Adapter: claude_local

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process (created if missing when possible)
- instructionsFilePath (string, optional): absolute path to a markdown instructions file injected at runtime
- model (string, optional): Claude model id
- effort (string, optional): reasoning effort passed via --effort (low|medium|high)
- chrome (boolean, optional): pass --chrome when running Claude
- promptTemplate (string, optional): run prompt template
- maxTurnsPerRun (number, optional): max turns for one run
- dangerouslySkipPermissions (boolean, optional): pass --dangerously-skip-permissions to claude
- command (string, optional): defaults to "claude"
- extraArgs (string[], optional): additional CLI args
- env (object, optional): KEY=VALUE environment variables
- workspaceStrategy (object, optional): execution workspace strategy; currently supports { type: "git_worktree", baseRef?, branchTemplate?, worktreeParentDir? }
- workspaceRuntime (object, optional): reserved for workspace runtime metadata; workspace runtime services are manually controlled from the workspace UI and are not auto-started by heartbeats

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds

Notes:
- When Paperclip realizes a workspace/runtime for a run, it injects PAPERCLIP_WORKSPACE_* and PAPERCLIP_RUNTIME_* env vars for agent-side tooling.
`;
