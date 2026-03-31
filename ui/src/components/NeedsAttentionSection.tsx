import { Link } from "@/lib/router";
import type { Agent, Issue } from "@paperclipai/shared";
import { AlertTriangle, XCircle, Clock } from "lucide-react";
import { agentUrl } from "@/lib/utils";

interface NeedsAttentionSectionProps {
  agents: Agent[];
  issues: Issue[];
  pendingApprovals: number;
}

export function NeedsAttentionSection({ agents, issues, pendingApprovals }: NeedsAttentionSectionProps) {
  const blockedIssues = issues.filter((i) => i.status === "blocked");
  const errorAgents = agents.filter((a) => a.status === "error");

  if (blockedIssues.length === 0 && errorAgents.length === 0 && pendingApprovals === 0) {
    return null;
  }

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Needs Attention
      </h3>
      <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
        {blockedIssues.length > 0 && (
          <Link
            to="/issues?status=blocked"
            className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent/50 transition-colors no-underline text-inherit"
          >
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
            <span className="flex-1">
              {blockedIssues.length} blocked task{blockedIssues.length === 1 ? "" : "s"}
            </span>
            <span className="text-xs text-muted-foreground">View →</span>
          </Link>
        )}
        {errorAgents.map((agent) => (
          <Link
            key={agent.id}
            to={agentUrl(agent)}
            className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent/50 transition-colors no-underline text-inherit"
          >
            <XCircle className="h-4 w-4 shrink-0 text-destructive" />
            <span className="flex-1">
              Agent <span className="font-medium">{agent.name}</span> has an error
            </span>
            <span className="text-xs text-muted-foreground">View →</span>
          </Link>
        ))}
        {pendingApprovals > 0 && (
          <Link
            to="/approvals"
            className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-accent/50 transition-colors no-underline text-inherit"
          >
            <Clock className="h-4 w-4 shrink-0 text-blue-500" />
            <span className="flex-1">
              {pendingApprovals} pending approval{pendingApprovals === 1 ? "" : "s"}
            </span>
            <span className="text-xs text-muted-foreground">View →</span>
          </Link>
        )}
      </div>
    </div>
  );
}
