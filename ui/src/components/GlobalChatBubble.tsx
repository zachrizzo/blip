import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare, X, Plus } from "lucide-react";
import { AGENT_ROLE_LABELS, type Agent } from "@paperclipai/shared";
import { agentsApi } from "../api/agents";
import { queryKeys } from "../lib/queryKeys";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { useSidebar } from "../context/SidebarContext";
import { agentStatusDot, agentStatusDotDefault } from "../lib/status-colors";
import { cn } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { AgentChatView } from "./AgentChatView";

const roleLabels = AGENT_ROLE_LABELS as Record<string, string>;

export function GlobalChatBubble() {
  const { chatBubbleOpen, chatBubbleAgentId, openChatBubble, closeChatBubble, openNewIssue } = useDialog();
  const { selectedCompanyId } = useCompany();
  const { isMobile } = useSidebar();

  const { data: agents = [] } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && chatBubbleOpen,
  });

  const activeAgents = useMemo(
    () => agents.filter((a) => a.status !== "terminated"),
    [agents],
  );

  // Pick the agent to show: explicit selection > first active agent
  const [localAgentId, setLocalAgentId] = useState<string | null>(null);

  useEffect(() => {
    if (chatBubbleAgentId) {
      setLocalAgentId(chatBubbleAgentId);
    } else if (!localAgentId && activeAgents.length > 0) {
      setLocalAgentId(activeAgents[0].id);
    }
  }, [chatBubbleAgentId, activeAgents, localAgentId]);

  const selectedAgent = activeAgents.find((a) => a.id === localAgentId) ?? activeAgents[0] ?? null;

  function handleSelectAgent(id: string) {
    setLocalAgentId(id);
    openChatBubble(id);
  }

  // Bottom position: on mobile, sit above the bottom nav (~4.5rem tall)
  const bubbleBottom = isMobile
    ? "bottom-[calc(env(safe-area-inset-bottom)+4.5rem)]"
    : "bottom-6";

  const panelBottom = isMobile
    ? "bottom-[calc(env(safe-area-inset-bottom)+6rem)]"
    : "bottom-24";

  return (
    <>
      {/* Expanded panel */}
      {chatBubbleOpen && (
        <div
          className={cn(
            "fixed right-6 z-50 flex flex-col",
            "w-[600px] h-[720px]",
            "rounded-xl border border-border bg-background shadow-2xl",
            isMobile && "w-[calc(100vw-3rem)] right-6",
            panelBottom,
          )}
        >
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-border px-3 py-2 shrink-0">
            <AgentPicker
              agents={activeAgents}
              selectedId={selectedAgent?.id ?? null}
              onSelect={handleSelectAgent}
            />
            <div className="ml-auto flex items-center gap-1">
              {selectedAgent && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
                  onClick={() => openNewIssue({ assigneeAgentId: selectedAgent.id })}
                >
                  <Plus className="h-3 w-3" />
                  New Ticket
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground shrink-0"
                onClick={closeChatBubble}
                aria-label="Close chat"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Chat body */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {selectedAgent ? (
              <AgentChatView
                agentId={selectedAgent.id}
                agentName={selectedAgent.name}
                companyId={selectedCompanyId ?? undefined}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-6">
                <MessageSquare className="h-8 w-8 text-muted-foreground/25" />
                <p className="text-sm text-muted-foreground/50">
                  {selectedCompanyId ? "No agents in this company yet." : "Select a company to start chatting."}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating bubble button */}
      <button
        type="button"
        onClick={() => (chatBubbleOpen ? closeChatBubble() : openChatBubble())}
        aria-label={chatBubbleOpen ? "Close chat" : "Open chat"}
        className={cn(
          "fixed right-6 z-50",
          "flex h-14 w-14 items-center justify-center rounded-full",
          "bg-cyan-600 text-white shadow-lg shadow-cyan-500/25",
          "hover:bg-cyan-700 transition-colors",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2",
          bubbleBottom,
        )}
      >
        {chatBubbleOpen ? (
          <X className="h-5 w-5" />
        ) : (
          <MessageSquare className="h-5 w-5" />
        )}
      </button>
    </>
  );
}

/* ── Agent picker ──────────────────────────────────────────────────── */

function AgentPicker({
  agents,
  selectedId,
  onSelect,
}: {
  agents: Agent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const selected = agents.find((a) => a.id === selectedId) ?? agents[0] ?? null;

  if (agents.length === 0) {
    return <span className="text-xs text-muted-foreground/50 py-1">No agents</span>;
  }

  return (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      {selected && (
        <span className="relative flex h-2 w-2 shrink-0">
          <span
            className={cn(
              "absolute inline-flex h-full w-full rounded-full",
              agentStatusDot[selected.status] ?? agentStatusDotDefault,
            )}
          />
        </span>
      )}
      <select
        value={selectedId ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        className={cn(
          "min-w-0 flex-1 truncate bg-transparent text-sm font-medium text-foreground",
          "focus:outline-none cursor-pointer",
          "appearance-none pr-4",
        )}
        aria-label="Select agent"
      >
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
            {a.role ? ` · ${roleLabels[a.role] ?? a.role}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
