import { useState, useRef, useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { agentsApi, type AgentMessage, type ChatThread } from "../api/agents";
import { heartbeatsApi, type LiveRunForIssue } from "../api/heartbeats";
import type { TranscriptEntry } from "../adapters";
import { queryKeys } from "../lib/queryKeys";
import { cn, relativeTime } from "../lib/utils";
import {
  Send, Loader2, User, Bot, ArrowDown, Plus,
  MessageSquare, Hash, CheckCircle2, XCircle,
  PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarkdownBody } from "./MarkdownBody";
import { MentionTextarea } from "./MentionTextarea";
import { RunTranscriptView } from "./transcript/RunTranscriptView";
import { useLiveRunTranscripts } from "./transcript/useLiveRunTranscripts";

interface AgentChatViewProps {
  agentId: string;
  agentName: string;
  companyId?: string;
  initialThreadId?: string;
}

export function AgentChatView({ agentId, agentName, companyId, initialThreadId }: AgentChatViewProps) {
  const [activeThreadId, setActiveThreadId] = useState<string | null>(initialThreadId ?? null);
  const [chatSidebarCollapsed, setChatSidebarCollapsed] = useState(false);
  const queryClient = useQueryClient();

  // Fetch threads — filter out heartbeat-generated run threads ("On-demand ·", "Timer ·", etc.)
  const HEARTBEAT_THREAD_RE = /^(On-demand|Timer|Automation) ·/;
  const { data: allThreads } = useQuery({
    queryKey: ["agentThreads", agentId],
    queryFn: () => agentsApi.getThreads(agentId),
    refetchInterval: 5000,
  });
  const threads = allThreads?.filter((t) => !HEARTBEAT_THREAD_RE.test(t.title ?? ""));

  // Auto-select initialThreadId if provided, else most recent thread
  useEffect(() => {
    if (!activeThreadId && threads && threads.length > 0) {
      setActiveThreadId(initialThreadId ?? threads[0].id);
    }
  }, [threads, activeThreadId, initialThreadId]);

  // Create new thread
  const createThread = useMutation({
    mutationFn: () => agentsApi.createThread(agentId, { title: "New Chat" }),
    onSuccess: (thread) => {
      queryClient.invalidateQueries({ queryKey: ["agentThreads", agentId] });
      setActiveThreadId(thread.id);
    },
  });

  const activeThread = threads?.find((t) => t.id === activeThreadId);

  return (
    <div className="flex h-full">
      {/* Thread sidebar — collapsible */}
      <div className={cn(
        "shrink-0 border-r border-border flex flex-col transition-all duration-200",
        chatSidebarCollapsed ? "w-10" : "w-52",
      )}>
        <div className={cn(
          "flex items-center border-b border-border/50",
          chatSidebarCollapsed ? "justify-center p-2" : "justify-between p-3",
        )}>
          {!chatSidebarCollapsed && (
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Chats</span>
          )}
          <div className="flex items-center gap-0.5">
            {!chatSidebarCollapsed && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => createThread.mutate()}
                disabled={createThread.isPending}
                title="New chat"
                className="text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setChatSidebarCollapsed(!chatSidebarCollapsed)}
              title={chatSidebarCollapsed ? "Show chats" : "Hide chats"}
              className="text-muted-foreground hover:text-foreground"
            >
              {chatSidebarCollapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
        {!chatSidebarCollapsed && (
          <div className="flex-1 overflow-y-auto">
            {(threads ?? []).length === 0 ? (
              <div className="px-3 py-6 text-center">
                <MessageSquare className="mx-auto h-5 w-5 text-muted-foreground/30 mb-2" />
                <p className="text-[10px] text-muted-foreground/40">No chats yet</p>
                <button
                  onClick={() => createThread.mutate()}
                  className="mt-2 text-[11px] text-cyan-600 hover:text-cyan-500"
                >
                  Start a chat
                </button>
              </div>
            ) : (
              (threads ?? []).map((thread) => (
                <button
                  key={thread.id}
                  onClick={() => setActiveThreadId(thread.id)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 border-b border-border/20 transition-colors",
                    activeThreadId === thread.id ? "bg-accent" : "hover:bg-accent/30",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    {thread.issueId ? (
                      <Hash className="h-3 w-3 text-cyan-500/60 shrink-0" />
                    ) : (
                      <MessageSquare className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                    )}
                    <span className="text-xs font-medium text-foreground/80 truncate flex-1">
                      {thread.title || "Untitled"}
                    </span>
                    {thread.runId && (
                      <span className={cn(
                        "h-2 w-2 rounded-full shrink-0",
                        thread.runStatus === "running" || thread.runStatus === "queued"
                          ? "bg-cyan-400 animate-pulse"
                          : thread.runStatus === "succeeded"
                            ? "bg-green-500/60"
                            : thread.runStatus === "failed" || thread.runStatus === "timed_out"
                              ? "bg-red-500/60"
                              : "bg-muted-foreground/20",
                      )} />
                    )}
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground/40 truncate">
                    {relativeTime(thread.updatedAt)}
                  </p>
                </button>
              ))
            )}
          </div>
        )}
        {chatSidebarCollapsed && (
          <div className="flex-1 overflow-y-auto flex flex-col items-center gap-1 pt-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => createThread.mutate()}
              disabled={createThread.isPending}
              title="New chat"
              className="text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
            {(threads ?? []).map((thread) => (
              <button
                key={thread.id}
                onClick={() => { setActiveThreadId(thread.id); setChatSidebarCollapsed(false); }}
                title={thread.title || "Untitled"}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
                  activeThreadId === thread.id ? "bg-accent" : "hover:bg-accent/30",
                )}
              >
                {thread.issueId ? (
                  <Hash className="h-3.5 w-3.5 text-cyan-500/60" />
                ) : (
                  <MessageSquare className="h-3.5 w-3.5 text-muted-foreground/40" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Chat area */}
      {activeThread ? (
        <ThreadChat
          thread={activeThread}
          agentId={agentId}
          agentName={agentName}
          companyId={companyId}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Bot className="mx-auto h-10 w-10 text-muted-foreground/20 mb-3" />
            <p className="text-sm text-muted-foreground/50">
              {threads && threads.length > 0
                ? "Select a chat"
                : `Start a chat with ${agentName}`}
            </p>
            {(!threads || threads.length === 0) && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => createThread.mutate()}
                disabled={createThread.isPending}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                New Chat
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Single thread chat ──────────────────────────────────────────── */

function ThreadChat({ thread, agentId, agentName, companyId }: {
  thread: ChatThread;
  agentId: string;
  agentName: string;
  companyId?: string;
}) {
  const [input, setInput] = useState("");
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data: messages, isLoading } = useQuery({
    queryKey: ["threadMessages", thread.id],
    queryFn: () => agentsApi.getThreadMessages(thread.id),
    refetchInterval: 3000,
  });

  // Check if the agent has a live run (for streaming)
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
        (thread.runId ? r.id === thread.runId : true),
    ),
    [liveRuns, agentId, thread.runId],
  );
  const isAgentRunning = agentLiveRuns.length > 0;

  // Get live transcripts for streaming display
  const { transcriptByRun } = useLiveRunTranscripts({
    runs: agentLiveRuns,
    companyId,
    maxChunksPerRun: 60,
  });

  // Cache completed run transcripts so they don't disappear when the live
  // run finishes. When a run transitions from active → terminal, snapshot
  // its transcript into a ref so ChatBubble can use it immediately without
  // waiting for RunTranscriptInline to re-fetch from the log store.
  const cachedTranscriptRef = useRef<Map<string, TranscriptEntry[]>>(new Map());
  useEffect(() => {
    for (const [runId, entries] of transcriptByRun) {
      if (entries.length > 0) {
        cachedTranscriptRef.current.set(runId, entries);
      }
    }
  }, [transcriptByRun]);

  const sendMutation = useMutation({
    mutationFn: (body: string) => agentsApi.sendThreadMessage(thread.id, body),
    onSuccess: () => {
      setInput("");
      queryClient.invalidateQueries({ queryKey: ["threadMessages", thread.id] });
      queryClient.invalidateQueries({ queryKey: ["agentThreads", agentId] });
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    },
  });

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || sendMutation.isPending) return;
    sendMutation.mutate(trimmed);
  };

  useEffect(() => {
    if (!showScrollBtn) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 100);
  };

  const sorted = useMemo(
    () => [...(messages ?? [])].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [messages],
  );

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 shrink-0">
        {thread.issueId ? (
          <Hash className="h-3.5 w-3.5 text-cyan-500/60" />
        ) : (
          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground/50" />
        )}
        <span className="text-sm font-medium text-foreground/80">{thread.title || "Untitled"}</span>
        <span className="text-xs text-muted-foreground/40">
          {sorted.length} message{sorted.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/40" />
          </div>
        ) : sorted.length === 0 && !isAgentRunning ? (
          <div className="flex flex-col items-center justify-center py-20 px-4">
            <Bot className="h-8 w-8 text-muted-foreground/25 mb-3" />
            <p className="text-sm text-muted-foreground/50">Send a message to start the conversation.</p>
            <p className="mt-1 text-xs text-muted-foreground/35">
              The agent will respond after its next run.
            </p>
          </div>
        ) : (
          <div className="px-4 py-4 space-y-1">
            {sorted.map((msg) => (
              <ChatBubble
                key={msg.id}
                message={msg}
                agentId={agentId}
                cachedTranscript={msg.runId ? cachedTranscriptRef.current.get(msg.runId) : undefined}
              />
            ))}

            {/* Completed run transcript at the bottom — only shown when the
                latest run has no associated agent message yet (e.g. agent ran
                but didn't produce a chat response). If there's already an
                agent message with this runId, its transcript is shown above. */}
            {thread.runId && !isAgentRunning && !sorted.some((m) => m.runId === thread.runId && m.senderType === "agent") && (
              <ThreadRunTranscript
                runId={thread.runId}
                agentId={agentId}
                companyId={thread.companyId}
              />
            )}

            {/* Live streaming response */}
            {isAgentRunning && agentLiveRuns.map((run) => (
              <LiveStreamBubble
                key={run.id}
                run={run}
                transcript={transcriptByRun.get(run.id) ?? []}
                agentName={agentName}
              />
            ))}

            <div ref={endRef} />
          </div>
        )}
      </div>

      {/* Scroll button */}
      {showScrollBtn && (
        <div className="relative">
          <button
            onClick={() => endRef.current?.scrollIntoView({ behavior: "smooth" })}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background shadow-md hover:bg-accent"
          >
            <ArrowDown className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-border bg-background/80 backdrop-blur-sm px-4 py-3 shrink-0">
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <MentionTextarea
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            companyId={companyId}
            placeholder={`Message ${agentName}... (@agent, #ticket)`}
            disabled={sendMutation.isPending}
            className={cn(
              "w-full resize-none rounded-xl border border-border/60 bg-background px-4 py-3 text-sm",
              "placeholder:text-muted-foreground/40",
              "focus:border-cyan-500/40 focus:outline-none focus:ring-1 focus:ring-cyan-500/20",
              "max-h-32",
            )}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || sendMutation.isPending}
            className={cn(
              "h-11 w-11 rounded-xl shrink-0 transition-all",
              input.trim()
                ? "bg-cyan-600 hover:bg-cyan-700 text-white shadow-lg shadow-cyan-500/20"
                : "bg-muted text-muted-foreground",
            )}
          >
            {sendMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
        <p className="mt-1.5 text-[10px] text-muted-foreground/40 text-center">
          Enter to send · Shift+Enter for new line · @ agents · # tickets
        </p>
      </div>
    </div>
  );
}

/* ── Chat bubble ─────────────────────────────────────────────────── */

function ChatBubble({ message, agentId, cachedTranscript }: {
  message: AgentMessage;
  agentId?: string;
  cachedTranscript?: TranscriptEntry[];
}) {
  const isUser = message.senderType === "user";
  const isAgent = message.senderType === "agent";
  // Transcript is expanded by default so actions/thinking are always visible
  const [showTranscript, setShowTranscript] = useState(true);

  return (
    <div className={cn("flex gap-3 py-2", isUser ? "flex-row-reverse" : "")}>
      <div className={cn(
        "shrink-0 flex h-7 w-7 items-center justify-center rounded-full",
        isUser ? "bg-cyan-600 text-white" : "bg-accent text-muted-foreground",
      )}>
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div className={cn("min-w-0 flex-1", isUser ? "max-w-[75%] flex flex-col items-end" : "max-w-[85%]")}>

        {/* For agent messages: show the run work BEFORE the response bubble */}
        {isAgent && message.runId && (
          <div className="w-full mb-2">
            <button
              onClick={() => setShowTranscript(!showTranscript)}
              className="flex items-center gap-1.5 mb-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
            >
              <CheckCircle2 className="h-3 w-3 text-green-500/60" />
              <span className="font-medium">Work done</span>
              <span className="text-muted-foreground/40">· run {message.runId.slice(0, 8)}</span>
              <span className="ml-1 text-muted-foreground/40">{showTranscript ? "— collapse" : "— expand"}</span>
            </button>
            {showTranscript && (
              <RunTranscriptInline
                runId={message.runId}
                agentId={agentId}
                preloadedTranscript={cachedTranscript}
              />
            )}
          </div>
        )}

        <div className={cn(
          "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-cyan-600 text-white rounded-br-md"
            : "bg-accent/60 text-foreground rounded-bl-md",
        )}>
          {isUser ? (
            <p className="whitespace-pre-wrap break-words">{message.body}</p>
          ) : (
            <MarkdownBody className="prose-sm prose-neutral dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_table]:text-xs [&_code]:text-xs [&_pre]:text-xs">
              {message.body}
            </MarkdownBody>
          )}
        </div>

        <div className={cn(
          "flex items-center gap-2 mt-1 px-1",
          isUser ? "justify-end" : "justify-start",
        )}>
          <span className="text-[10px] text-muted-foreground/40">{relativeTime(message.createdAt)}</span>
          {isUser && message.status === "delivered" && (
            <span className="text-[10px] text-green-500/50">Delivered</span>
          )}
          {isUser && message.status === "pending" && (
            <span className="text-[10px] text-amber-500/50">Pending</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Shows a link to the full run with transcript */
function RunTranscriptInline({ runId, agentId, preloadedTranscript }: {
  runId: string;
  agentId?: string;
  /** Transcript already in memory from the live stream — shown instantly, no fetch needed */
  preloadedTranscript?: TranscriptEntry[];
}) {
  const { data: run } = useQuery({
    queryKey: ["runDetail", runId],
    queryFn: () => heartbeatsApi.get(runId),
    staleTime: 300_000, // 5 min — completed runs don't change
  });

  // Fetch the agent to get its adapterType so the correct parser is used
  const { data: agent } = useQuery({
    queryKey: queryKeys.agents.detail(agentId ?? run?.agentId ?? ""),
    queryFn: () => agentsApi.get(agentId ?? run?.agentId ?? ""),
    enabled: !!(agentId || run?.agentId),
    staleTime: 300_000,
  });

  // Only fetch from log store if we don't have a preloaded transcript
  const runs = useMemo(() => {
    if (preloadedTranscript && preloadedTranscript.length > 0) return [];
    return run ? [{
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
    } satisfies LiveRunForIssue] : [];
  }, [run, agent, preloadedTranscript]);

  const { transcriptByRun } = useLiveRunTranscripts({ runs, companyId: run?.companyId, maxChunksPerRun: 400 });

  // Use preloaded transcript (from live stream) if available, otherwise use fetched
  const rawTranscript = preloadedTranscript && preloadedTranscript.length > 0
    ? preloadedTranscript
    : (transcriptByRun.get(runId) ?? []);

  // Filter to only meaningful entries — hide raw stdout/stderr/system noise
  const transcript = useMemo(() => rawTranscript.filter((e) => {
    if (e.kind === "stdout" || e.kind === "stderr") return false;
    if (e.kind === "system") return false;
    if (e.kind === "init") return false;
    if (e.kind === "result") return false;
    return true;
  }), [rawTranscript]);

  // Show loader only if we have nothing yet — preloaded transcript means instant display
  if (!run && !preloadedTranscript) {
    return (
      <div className="mt-2 rounded-xl border border-border/30 bg-background/50 px-3 py-3">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-border/30 bg-background/50 overflow-hidden">
      {transcript.length > 0 && (
        <div className="max-h-[350px] overflow-y-auto px-3 py-2">
          <RunTranscriptView
            entries={transcript}
            density="compact"
            limit={30}
            streaming={false}
            collapseStdout
            thinkingClassName="!text-[10px] !leading-4"
            emptyMessage="No transcript data"
          />
        </div>
      )}
      <div className={cn("px-3 py-1.5 flex items-center gap-3 text-[10px]", transcript.length > 0 && "border-t border-border/20")}>
        <span className="text-muted-foreground/40">
          {run ? (run.status === "succeeded" ? "Completed" : run.status) : "Completed"} · {run?.usageJson ? `${((run.usageJson as Record<string, unknown>).inputTokens as number ?? 0).toLocaleString()} tok` : ""}
        </span>
        {agentId && (
          <Link
            to={`/agents/${agentId}/runs/${runId}`}
            className="text-cyan-600 hover:text-cyan-500 ml-auto"
          >
            Open full run →
          </Link>
        )}
      </div>
    </div>
  );
}

/* ── Live stream bubble ──────────────────────────────────────────── */

function LiveStreamBubble({ run, transcript, agentName }: {
  run: LiveRunForIssue;
  transcript: TranscriptEntry[];
  agentName: string;
}) {
  const [expanded, setExpanded] = useState(true);

  // Extract the latest assistant/thinking text
  const latestText = useMemo(() => {
    for (let i = transcript.length - 1; i >= 0; i--) {
      const e = transcript[i];
      if (e.kind === "assistant" && e.text?.trim()) return e.text.trim();
      if (e.kind === "thinking" && e.text?.trim()) return e.text.trim();
    }
    return null;
  }, [transcript]);

  // Current activity label
  const currentActivity = useMemo(() => {
    for (let i = transcript.length - 1; i >= 0; i--) {
      const e = transcript[i];
      if (e.kind === "tool_call") return `Using ${e.name}`;
      if (e.kind === "thinking") return "Thinking...";
      if (e.kind === "assistant") return "Writing...";
    }
    return "Starting up...";
  }, [transcript]);

  return (
    <div className="flex gap-3 py-2">
      <div className="shrink-0 flex h-7 w-7 items-center justify-center rounded-full bg-cyan-500/10 text-cyan-600">
        <Bot className="h-3.5 w-3.5" />
      </div>
      <div className="max-w-[85%] min-w-0 flex-1">
        <div className="rounded-2xl rounded-bl-md border border-cyan-500/20 bg-gradient-to-b from-cyan-50/50 to-background dark:from-cyan-950/20 overflow-hidden">
          {/* Header */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-accent/20 transition-colors"
          >
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" />
            </span>
            <span className="text-[12px] font-medium text-cyan-700 dark:text-cyan-400">
              {agentName} is working
            </span>
            <span className="text-[10px] text-muted-foreground/50 ml-1">{currentActivity}</span>
            <span className="ml-auto text-[10px] text-muted-foreground/40">
              {expanded ? "collapse" : "expand"}
            </span>
          </button>

          {/* Latest text preview with cursor */}
          {latestText && (
            <div className="px-4 pb-3 border-t border-cyan-500/10">
              <div className="mt-2 text-sm leading-relaxed">
                <MarkdownBody className="prose-sm prose-neutral dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                  {latestText.length > 500 ? latestText.slice(-500) : latestText}
                </MarkdownBody>
                <span className="inline-block w-1.5 h-4 bg-cyan-500/60 animate-pulse ml-0.5 align-text-bottom rounded-sm" />
              </div>
            </div>
          )}

          {/* Expandable transcript */}
          {expanded && transcript.length > 0 && (
            <div className="border-t border-cyan-500/10 px-4 py-2 max-h-[250px] overflow-y-auto bg-background/50">
              <RunTranscriptView
                entries={transcript}
                density="compact"
                limit={15}
                streaming
                collapseStdout
                thinkingClassName="!text-[10px] !leading-4"
                emptyMessage=""
              />
            </div>
          )}
        </div>
        <div className="mt-1 px-1">
          <span className="text-[10px] text-muted-foreground/40">Streaming live</span>
        </div>
      </div>
    </div>
  );
}

/* ── Thread run transcript (completed) ──────────────────────────── */

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

  if (!run) return null;
  if (run.status === "queued" || run.status === "running") return null;
  if (transcript.length === 0) return null;

  return (
    <div className="mx-0 my-2 rounded-xl border border-border/30 bg-background/50 overflow-hidden">
      <div className="px-3 py-2 border-b border-border/20 flex items-center gap-2">
        {run.status === "succeeded" ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-green-500/60" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-red-500/60" />
        )}
        <span className="text-[11px] font-medium text-muted-foreground/60">Run transcript</span>
        <span className="text-[10px] text-muted-foreground/40 ml-auto">
          {run.status}
          {run.usageJson ? ` · ${((run.usageJson as Record<string, unknown>).inputTokens as number ?? 0).toLocaleString()} tokens` : ""}
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
