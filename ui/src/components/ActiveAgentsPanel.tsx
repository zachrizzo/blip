import { useMemo } from "react";
import { Link } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Agent, HeartbeatRun, Issue } from "@paperclipai/shared";
import { heartbeatsApi, type LiveRunForIssue } from "../api/heartbeats";
import { issuesApi } from "../api/issues";
import type { TranscriptEntry } from "../adapters";
import { queryKeys } from "../lib/queryKeys";
import { cn, relativeTime, visibleRunCostUsd, agentUrl } from "../lib/utils";
import { ExternalLink, Square, Wrench, Play } from "lucide-react";
import { Identity } from "./Identity";
import { RunTranscriptView } from "./transcript/RunTranscriptView";
import { useLiveRunTranscripts } from "./transcript/useLiveRunTranscripts";
import { AgentChatPanel } from "./AgentChatPanel";
import { AgentRunDots } from "./AgentRunDots";

function isRunActive(run: LiveRunForIssue): boolean {
  return run.status === "queued" || run.status === "running";
}

function getCurrentTool(transcript: TranscriptEntry[]): string | null {
  const pendingTools = new Set<string>();
  for (const entry of transcript) {
    if (entry.kind === "tool_call") {
      pendingTools.add(entry.toolUseId ?? entry.name);
    } else if (entry.kind === "tool_result") {
      pendingTools.delete(entry.toolUseId);
    }
  }
  for (let i = transcript.length - 1; i >= 0; i--) {
    const entry = transcript[i];
    if (entry.kind === "tool_call") {
      const id = entry.toolUseId ?? entry.name;
      if (pendingTools.has(id)) {
        return humanizeToolName(entry.name, entry.input);
      }
    }
  }
  return null;
}

function humanizeToolName(name: string, input: unknown): string {
  if (
    (name === "Bash" || name === "execute_command" || name === "run_terminal_command") &&
    typeof input === "object" && input !== null
  ) {
    const cmd = (input as Record<string, unknown>).command ?? (input as Record<string, unknown>).cmd;
    if (typeof cmd === "string") {
      const short = cmd.split("\n")[0].slice(0, 40);
      return short.length < cmd.split("\n")[0].length ? `${short}...` : short;
    }
    return "Running command";
  }
  if (name === "Read" || name === "read_file") return "Reading file";
  if (name === "Write" || name === "write_to_file") return "Writing file";
  if (name === "Edit" || name === "replace_in_file") return "Editing file";
  if (name === "Grep" || name === "search_files") return "Searching code";
  if (name === "Glob" || name === "list_files") return "Finding files";
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

type AgentCardVariant = "running" | "paused" | "idle" | "error";

function getVariant(agentStatus: string, run: LiveRunForIssue | undefined): AgentCardVariant {
  if (run && isRunActive(run)) return "running";
  if (agentStatus === "paused") return "paused";
  if (agentStatus === "error") return "error";
  return "idle";
}

interface AgentCardProps {
  agentId: string;
  agentName: string;
  agent?: Agent;
  run?: LiveRunForIssue;
  issue?: Issue;
  recentRuns: HeartbeatRun[];
  transcript: TranscriptEntry[];
  hasOutput: boolean;
  onCancelRun?: () => void;
}

function AgentCard({
  agentId,
  agentName,
  agent,
  run,
  issue,
  recentRuns,
  transcript,
  hasOutput,
  onCancelRun,
}: AgentCardProps) {
  const agentStatus = agent?.status ?? (run ? "active" : "idle");
  const variant = getVariant(agentStatus, run);
  const isActive = variant === "running";
  const currentTool = isActive ? getCurrentTool(transcript) : null;
  const costUsd = run ? visibleRunCostUsd(run.usageJson ?? null) : 0;

  const agentLink = agent ? agentUrl(agent) : `/agents/${agentId}`;
  const runDetailLink = run ? `${agentLink}/runs/${run.id}` : agentLink;

  const borderClass = {
    running:
      "border-cyan-500/30 shadow-[0_0_0_1px_rgba(6,182,212,0.08),0_8px_32px_rgba(6,182,212,0.10)]",
    paused: "border-amber-500/20 hover:border-amber-500/30 hover:shadow-md",
    error: "border-red-500/25 hover:border-red-500/35 hover:shadow-md",
    idle: "border-border/40 hover:border-border/70 hover:shadow-md",
  }[variant];

  const gradientClass = {
    running: "bg-gradient-to-b from-cyan-950/20 via-background/90 to-background/70",
    paused: "bg-gradient-to-b from-amber-950/10 via-background/90 to-background/70",
    error: "bg-gradient-to-b from-red-950/10 via-background/90 to-background/70",
    idle: "bg-gradient-to-b from-card/60 to-background/50",
  }[variant];

  const accentGradient = {
    running: "from-transparent via-cyan-400/50 to-transparent",
    paused: "from-transparent via-amber-400/30 to-transparent",
    error: "from-transparent via-red-400/30 to-transparent",
    idle: null,
  }[variant];

  const dotClass = {
    running: null,
    paused: "bg-amber-400",
    error: "bg-red-400",
    idle: "bg-muted-foreground/25",
  }[variant];

  const statusText = {
    running: "Live now",
    paused: `Paused${agent?.pauseReason ? ` · ${agent.pauseReason.replace(/_/g, " ")}` : ""}`,
    error: "Error",
    idle: agent?.lastHeartbeatAt
      ? `Last active ${relativeTime(agent.lastHeartbeatAt)}`
      : run?.finishedAt
      ? `Finished ${relativeTime(run.finishedAt)}`
      : "Never run",
  }[variant];

  const statusTextClass = {
    running: "text-cyan-400/60 font-medium",
    paused: "text-amber-500/60",
    error: "text-red-400/70",
    idle: "text-muted-foreground/50",
  }[variant];

  const footerClass = {
    running: "border-cyan-500/10 bg-cyan-950/10",
    paused: "border-amber-500/10 bg-amber-950/5",
    error: "border-red-500/10 bg-red-950/5",
    idle: "border-border/30 bg-card/30",
  }[variant];

  const cardHeight = isActive ? "h-[340px]" : "min-h-[190px]";

  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border transition-all duration-300",
        cardHeight,
        borderClass,
        gradientClass,
      )}
    >
      {/* Top accent line */}
      {accentGradient && (
        <div
          className={cn(
            "absolute inset-x-0 top-0 h-px bg-gradient-to-r",
            accentGradient,
          )}
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-2 px-4 pt-4 pb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {isActive ? (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" />
              </span>
            ) : (
              <span className={cn("inline-flex h-2 w-2 rounded-full shrink-0", dotClass)} />
            )}
            <Identity
              name={agentName}
              size="sm"
              className="[&>span:last-child]:!text-[11px] [&>span:last-child]:font-medium"
            />
          </div>
          <p className={cn("mt-1 text-[10px] tracking-wide", statusTextClass)}>{statusText}</p>
        </div>

        <Link
          to={runDetailLink}
          className={cn(
            "shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-lg border transition-all",
            isActive
              ? "border-cyan-500/20 bg-cyan-500/5 text-cyan-500/40 hover:border-cyan-500/40 hover:text-cyan-400"
              : "border-border/40 bg-background/40 text-muted-foreground/30 hover:border-border hover:text-muted-foreground",
          )}
        >
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {/* Run history dots + current tool + cost */}
      <div className="flex items-center gap-2 px-4 pb-2">
        <AgentRunDots runs={recentRuns} />
        {currentTool && (
          <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-cyan-500/10 bg-cyan-500/[0.04] px-2 py-1">
            <Wrench className="h-3 w-3 shrink-0 text-cyan-500/50" />
            <span className="truncate text-[10px] font-medium text-cyan-400/70">{currentTool}</span>
          </div>
        )}
        {costUsd > 0 && (
          <div className="flex shrink-0 items-center gap-1 rounded-md border border-border/30 bg-background/40 px-1.5 py-1">
            <span className="text-[10px] font-mono text-muted-foreground/60">{formatCost(costUsd)}</span>
          </div>
        )}
      </div>

      {/* Issue pill */}
      {run?.issueId && (
        <div className="px-4 pb-2">
          <Link
            to={`/issues/${issue?.identifier ?? run.issueId}`}
            title={
              issue?.title
                ? `${issue?.identifier ?? run.issueId.slice(0, 8)} — ${issue.title}`
                : undefined
            }
            className={cn(
              "inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] transition-colors",
              isActive
                ? "border-cyan-500/15 bg-cyan-500/5 text-cyan-300/60 hover:text-cyan-300"
                : "border-border/40 bg-muted/20 text-muted-foreground/60 hover:text-foreground",
            )}
          >
            <span className="shrink-0 font-mono text-[10px] opacity-70">
              {issue?.identifier ?? run.issueId.slice(0, 8)}
            </span>
            {issue?.title && (
              <>
                <span className="opacity-25">·</span>
                <span className="truncate">{issue.title}</span>
              </>
            )}
          </Link>
        </div>
      )}

      {/* Agent capabilities (non-running states) */}
      {!isActive && (agent?.title || agent?.capabilities) && (
        <div className="flex-1 px-4 py-1">
          {agent.title && (
            <p className="text-[11px] text-muted-foreground/50 truncate">{agent.title}</p>
          )}
          {agent.capabilities && (
            <p className="mt-0.5 text-[10px] text-muted-foreground/40 line-clamp-2">
              {agent.capabilities}
            </p>
          )}
        </div>
      )}

      {/* Transcript (running only) */}
      {isActive && (
        <>
          <div className="mx-4 border-t border-cyan-500/10" />
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <RunTranscriptView
              entries={transcript}
              density="compact"
              limit={5}
              streaming
              collapseStdout
              thinkingClassName="!text-[10px] !leading-4"
              emptyMessage={
                hasOutput ? "Waiting for transcript parsing..." : "Waiting for output..."
              }
            />
          </div>
        </>
      )}

      {/* Footer: chat + actions */}
      <div className={cn("border-t space-y-1.5 px-3 py-2 mt-auto", footerClass)}>
        <AgentChatPanel agentId={agentId} runId={run?.id} />
        <div className="flex items-center gap-1.5">
          <Link
            to={agentLink}
            className="flex-1 rounded-lg border border-border/30 bg-background/40 px-2.5 py-1 text-center text-[10px] font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          >
            {isActive ? "View Details" : "View Agent"}
          </Link>
          {isActive && (
            <button
              onClick={onCancelRun}
              className="rounded-lg border border-red-500/15 bg-red-500/[0.04] px-2.5 py-1 text-[10px] font-medium text-red-400/70 transition-colors hover:bg-red-500/[0.1] hover:text-red-400"
            >
              <Square className="inline-block h-2.5 w-2.5 mr-1" fill="currentColor" />
              Stop
            </button>
          )}
          {variant === "paused" && (
            <span className="text-[10px] text-amber-500/50 flex items-center gap-1 px-1">
              <Play className="h-2.5 w-2.5" />
              Paused
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

interface ActiveAgentsPanelProps {
  companyId: string;
  agents?: Agent[];
  allRuns?: HeartbeatRun[];
}

export function ActiveAgentsPanel({ companyId, agents: allAgents, allRuns }: ActiveAgentsPanelProps) {
  const queryClient = useQueryClient();

  const { data: liveRuns } = useQuery({
    queryKey: [...queryKeys.liveRuns(companyId), "dashboard"],
    queryFn: () => heartbeatsApi.liveRunsForCompany(companyId),
  });

  const runs = liveRuns ?? [];

  const { data: issues } = useQuery({
    queryKey: queryKeys.issues.list(companyId),
    queryFn: () => issuesApi.list(companyId),
    enabled: runs.length > 0,
  });

  const issueById = useMemo(() => {
    const map = new Map<string, Issue>();
    for (const issue of issues ?? []) map.set(issue.id, issue);
    return map;
  }, [issues]);

  const { transcriptByRun, hasOutputForRun } = useLiveRunTranscripts({
    runs,
    companyId,
    maxChunksPerRun: 120,
  });

  const cancelRun = useMutation({
    mutationFn: (runId: string) => heartbeatsApi.cancel(runId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.liveRuns(companyId) });
    },
  });

  const agentById = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of allAgents ?? []) map.set(a.id, a);
    return map;
  }, [allAgents]);

  const agentIdsWithRuns = useMemo(() => new Set(runs.map((r) => r.agentId)), [runs]);

  // Per-agent run history from the passed allRuns (fetched once at dashboard level)
  const runsByAgent = useMemo(() => {
    const map = new Map<string, HeartbeatRun[]>();
    for (const run of allRuns ?? []) {
      if (!map.has(run.agentId)) map.set(run.agentId, []);
      map.get(run.agentId)!.push(run);
    }
    return map;
  }, [allRuns]);

  const pausedAgents = useMemo(
    () => (allAgents ?? []).filter((a) => a.status === "paused" && !agentIdsWithRuns.has(a.id)),
    [allAgents, agentIdsWithRuns],
  );

  const idleAgents = useMemo(
    () =>
      (allAgents ?? []).filter(
        (a) =>
          (a.status === "active" || a.status === "idle") && !agentIdsWithRuns.has(a.id),
      ),
    [allAgents, agentIdsWithRuns],
  );

  const errorAgents = useMemo(
    () => (allAgents ?? []).filter((a) => a.status === "error" && !agentIdsWithRuns.has(a.id)),
    [allAgents, agentIdsWithRuns],
  );

  const hasContent =
    runs.length > 0 ||
    pausedAgents.length > 0 ||
    idleAgents.length > 0 ||
    errorAgents.length > 0;

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Agents
      </h3>
      {!hasContent ? (
        <div className="flex items-center gap-3 rounded-2xl border border-border/40 bg-card/30 px-4 py-3.5">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-muted-foreground/25" />
          <p className="text-sm text-muted-foreground/60">No active agent runs.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {runs.map((run) => (
            <AgentCard
              key={run.id}
              agentId={run.agentId}
              agentName={run.agentName}
              agent={agentById.get(run.agentId)}
              run={run}
              issue={run.issueId ? issueById.get(run.issueId) : undefined}
              recentRuns={runsByAgent.get(run.agentId) ?? []}
              transcript={transcriptByRun.get(run.id) ?? []}
              hasOutput={hasOutputForRun(run.id)}
              onCancelRun={() => cancelRun.mutate(run.id)}
            />
          ))}
          {[...idleAgents, ...pausedAgents, ...errorAgents].map((agent) => (
            <AgentCard
              key={agent.id}
              agentId={agent.id}
              agentName={agent.name}
              agent={agent}
              recentRuns={runsByAgent.get(agent.id) ?? []}
              transcript={[]}
              hasOutput={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}
