import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { agentsApi } from "../api/agents";
import { Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AgentChatPanelProps {
  agentId: string;
  runId?: string;
  compact?: boolean;
  placeholder?: string;
}

/**
 * Compact chat input for sending messages to an agent.
 * Uses `sendAgentMessage` which auto-resumes the last session.
 * Used on dashboard run cards, paused agent cards, and issue live runs.
 */
export function AgentChatPanel({ agentId, runId, placeholder }: AgentChatPanelProps) {
  const [input, setInput] = useState("");
  const queryClient = useQueryClient();

  const sendMutation = useMutation({
    mutationFn: (body: string) =>
      runId
        ? agentsApi.sendRunMessage(runId, body)
        : agentsApi.sendAgentMessage(agentId, body),
    onSuccess: () => {
      setInput("");
      queryClient.invalidateQueries({ queryKey: ["agentMessages", agentId] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || sendMutation.isPending) return;
    sendMutation.mutate(trimmed);
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={placeholder ?? "Message this agent..."}
        className="flex-1 rounded-lg border border-border/50 bg-background/60 px-3 py-2 text-sm placeholder:text-muted-foreground/40 focus:border-cyan-500/30 focus:outline-none"
      />
      <Button
        type="submit"
        variant="ghost"
        size="icon-sm"
        disabled={!input.trim() || sendMutation.isPending}
        className="text-cyan-500/60 hover:text-cyan-400"
      >
        {sendMutation.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Send className="h-3.5 w-3.5" />
        )}
      </Button>
    </form>
  );
}
