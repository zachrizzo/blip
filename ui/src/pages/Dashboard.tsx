import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { dashboardApi } from "../api/dashboard";
import { activityApi } from "../api/activity";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { projectsApi } from "../api/projects";
import { heartbeatsApi } from "../api/heartbeats";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { MetricCard } from "../components/MetricCard";
import { EmptyState } from "../components/EmptyState";
import { StatusIcon } from "../components/StatusIcon";
import { ActivityRow } from "../components/ActivityRow";
import { Identity } from "../components/Identity";
import { NeedsAttentionSection } from "../components/NeedsAttentionSection";
import { timeAgo } from "../lib/timeAgo";
import { cn, formatDate } from "../lib/utils";
import {
  Bot,
  CircleDot,
  ShieldCheck,
  LayoutDashboard,
  Pause,
  Square,
  Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ActiveAgentsPanel } from "../components/ActiveAgentsPanel";
import { ChartCard, RunActivityChart, PriorityChart, IssueStatusChart, SuccessRateChart } from "../components/ActivityCharts";
import { PageSkeleton } from "../components/PageSkeleton";
import type { Agent, ActivityEvent, Issue } from "@paperclipai/shared";
import { PluginSlotOutlet } from "@/plugins/slots";

const priorityBadgeClass: Record<string, string> = {
  critical: "border-red-500/30 bg-red-500/10 text-red-500",
  high: "border-orange-500/30 bg-orange-500/10 text-orange-500",
  medium: "border-yellow-500/30 bg-yellow-500/10 text-yellow-500",
  low: "border-muted/50 bg-muted/20 text-muted-foreground",
};

function groupByDay(items: ActivityEvent[]): { label: string; items: ActivityEvent[] }[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const map = new Map<string, ActivityEvent[]>();
  for (const item of items) {
    const d = new Date(item.createdAt);
    d.setHours(0, 0, 0, 0);
    const key = d.toISOString();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }

  return Array.from(map.entries()).map(([key, groupItems]) => {
    const d = new Date(key);
    let label: string;
    if (d.getTime() === today.getTime()) label = "Today";
    else if (d.getTime() === yesterday.getTime()) label = "Yesterday";
    else label = formatDate(d).replace(/, \d{4}$/, ""); // "Mar 28" (strip year)
    return { label, items: groupItems };
  });
}

function getRecentIssues(issues: Issue[]): Issue[] {
  return [...issues].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export function Dashboard() {
  const { selectedCompanyId, companies } = useCompany();
  const navigate = useNavigate();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [animatedActivityIds, setAnimatedActivityIds] = useState<Set<string>>(new Set());
  const seenActivityIdsRef = useRef<Set<string>>(new Set());
  const hydratedActivityRef = useRef(false);
  const activityAnimationTimersRef = useRef<number[]>([]);
  const [confirmStop, setConfirmStop] = useState(false);

  const invalidateAgents = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(selectedCompanyId!) });

  const pauseAll = useMutation({
    mutationFn: () => agentsApi.pauseAll(selectedCompanyId!),
    onSuccess: invalidateAgents,
  });

  const resumeAll = useMutation({
    mutationFn: () => agentsApi.resumeAll(selectedCompanyId!),
    onSuccess: invalidateAgents,
  });

  const stopAll = useMutation({
    mutationFn: () => agentsApi.stopAll(selectedCompanyId!),
    onSuccess: () => { setConfirmStop(false); void invalidateAgents(); },
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "Dashboard" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.dashboard(selectedCompanyId!),
    queryFn: () => dashboardApi.summary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: activity } = useQuery({
    queryKey: queryKeys.activity(selectedCompanyId!),
    queryFn: () => activityApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: issues } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: runs } = useQuery({
    queryKey: queryKeys.heartbeats(selectedCompanyId!),
    queryFn: () => heartbeatsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const recentIssues = issues ? getRecentIssues(issues) : [];
  const recentActivity = useMemo(() => (activity ?? []).slice(0, 20), [activity]);

  useEffect(() => {
    for (const timer of activityAnimationTimersRef.current) {
      window.clearTimeout(timer);
    }
    activityAnimationTimersRef.current = [];
    seenActivityIdsRef.current = new Set();
    hydratedActivityRef.current = false;
    setAnimatedActivityIds(new Set());
  }, [selectedCompanyId]);

  useEffect(() => {
    if (recentActivity.length === 0) return;

    const seen = seenActivityIdsRef.current;
    const currentIds = recentActivity.map((event) => event.id);

    if (!hydratedActivityRef.current) {
      for (const id of currentIds) seen.add(id);
      hydratedActivityRef.current = true;
      return;
    }

    const newIds = currentIds.filter((id) => !seen.has(id));
    if (newIds.length === 0) {
      for (const id of currentIds) seen.add(id);
      return;
    }

    setAnimatedActivityIds((prev) => {
      const next = new Set(prev);
      for (const id of newIds) next.add(id);
      return next;
    });

    for (const id of newIds) seen.add(id);

    const timer = window.setTimeout(() => {
      setAnimatedActivityIds((prev) => {
        const next = new Set(prev);
        for (const id of newIds) next.delete(id);
        return next;
      });
      activityAnimationTimersRef.current = activityAnimationTimersRef.current.filter(
        (t) => t !== timer,
      );
    }, 980);
    activityAnimationTimersRef.current.push(timer);
  }, [recentActivity]);

  useEffect(() => {
    return () => {
      for (const timer of activityAnimationTimersRef.current) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents ?? []) map.set(a.id, a);
    return map;
  }, [agents]);

  const entityNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues ?? []) map.set(`issue:${i.id}`, i.identifier ?? i.id.slice(0, 8));
    for (const a of agents ?? []) map.set(`agent:${a.id}`, a.name);
    for (const p of projects ?? []) map.set(`project:${p.id}`, p.name);
    return map;
  }, [issues, agents, projects]);

  const entityTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues ?? []) map.set(`issue:${i.id}`, i.title);
    return map;
  }, [issues]);

  const agentName = (id: string | null) => {
    if (!id || !agents) return null;
    return agents.find((a) => a.id === id)?.name ?? null;
  };

  const activityGroups = useMemo(() => groupByDay(recentActivity), [recentActivity]);

  if (!selectedCompanyId) {
    if (companies.length === 0) {
      return (
        <EmptyState
          icon={LayoutDashboard}
          message="Welcome to Paperclip. Set up your first company and agent to get started."
          action="Get Started"
          onAction={() => navigate("/onboarding/new")}
        />
      );
    }
    return (
      <EmptyState icon={LayoutDashboard} message="Create or select a company to view the dashboard." />
    );
  }

  if (isLoading) {
    return <PageSkeleton variant="dashboard" />;
  }

  const hasNoAgents = agents !== undefined && agents.length === 0;
  const hasActiveAgents = (agents ?? []).some(
    (a) => a.status !== "paused" && a.status !== "terminated",
  );
  const hasPausedAgents = (agents ?? []).some((a) => a.status === "paused");

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {hasNoAgents && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-500/25 dark:bg-amber-950/60">
          <div className="flex items-center gap-2.5">
            <Bot className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-sm text-amber-900 dark:text-amber-100">You have no agents.</p>
          </div>
          <button
            onClick={() => navigate("/onboarding/new")}
            className="text-sm font-medium text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100 underline underline-offset-2 shrink-0"
          >
            Create one here
          </button>
        </div>
      )}

      {data && (
        <>
          {/* Metrics + Bulk Controls */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-1 sm:gap-2 flex-1">
              <MetricCard
                icon={Bot}
                value={
                  data.agents.active +
                  data.agents.running +
                  data.agents.paused +
                  data.agents.error
                }
                label="Agents Enabled"
                to="/agents"
                description={
                  <span>
                    {data.agents.running} running{", "}
                    {data.agents.paused} paused{", "}
                    {data.agents.error} errors
                  </span>
                }
              />
              <MetricCard
                icon={CircleDot}
                value={data.tasks.inProgress}
                label="Tasks In Progress"
                to="/issues"
                description={
                  <span>
                    {data.tasks.open} open{", "}
                    {data.tasks.blocked} blocked
                  </span>
                }
              />
              <MetricCard
                icon={ShieldCheck}
                value={data.pendingApprovals + data.budgets.pendingApprovals}
                label="Pending Approvals"
                to="/approvals"
                description={
                  <span>
                    {data.budgets.pendingApprovals > 0
                      ? `${data.budgets.pendingApprovals} budget approvals`
                      : "Awaiting board review"}
                  </span>
                }
              />
            </div>

            {/* Bulk agent controls */}
            {agents && agents.length > 0 && (hasActiveAgents || hasPausedAgents) && (
              <div className="flex gap-2 shrink-0">
                {hasActiveAgents ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-yellow-500/50 text-yellow-500 hover:bg-yellow-500/10 hover:text-yellow-400"
                      onClick={() => { setConfirmStop(false); pauseAll.mutate(); }}
                      disabled={pauseAll.isPending || stopAll.isPending}
                    >
                      <Pause className="h-3.5 w-3.5 mr-1.5" />
                      {pauseAll.isPending ? "Pausing…" : "Pause All"}
                    </Button>
                    {confirmStop ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => stopAll.mutate()}
                        disabled={stopAll.isPending}
                        onBlur={() => setConfirmStop(false)}
                        autoFocus
                      >
                        <Square className="h-3.5 w-3.5 mr-1.5 fill-current" />
                        {stopAll.isPending ? "Stopping…" : "Confirm Stop"}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-destructive/50 text-destructive hover:bg-destructive/10"
                        onClick={() => setConfirmStop(true)}
                        disabled={pauseAll.isPending || stopAll.isPending}
                      >
                        <Square className="h-3.5 w-3.5 mr-1.5 fill-current" />
                        Stop All
                      </Button>
                    )}
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-green-500/50 text-green-500 hover:bg-green-500/10 hover:text-green-400"
                    onClick={() => { setConfirmStop(false); resumeAll.mutate(); }}
                    disabled={resumeAll.isPending}
                  >
                    <Play className="h-3.5 w-3.5 mr-1.5 fill-green-500" />
                    {resumeAll.isPending ? "Resuming…" : "Resume All"}
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Agent Control Center */}
          <ActiveAgentsPanel
            companyId={selectedCompanyId!}
            agents={agents}
            allRuns={runs}
          />

          {/* Needs Attention */}
          {agents && issues && (
            <NeedsAttentionSection
              agents={agents}
              issues={issues}
              pendingApprovals={data.pendingApprovals + data.budgets.pendingApprovals}
            />
          )}

          {/* Charts */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <ChartCard title="Run Activity" subtitle="Last 14 days">
              <RunActivityChart runs={runs ?? []} />
            </ChartCard>
            <ChartCard title="Issues by Priority" subtitle="Last 14 days">
              <PriorityChart issues={issues ?? []} />
            </ChartCard>
            <ChartCard title="Issues by Status" subtitle="Last 14 days">
              <IssueStatusChart issues={issues ?? []} />
            </ChartCard>
            <ChartCard title="Success Rate" subtitle="Last 14 days">
              <SuccessRateChart runs={runs ?? []} />
            </ChartCard>
          </div>

          <PluginSlotOutlet
            slotTypes={["dashboardWidget"]}
            context={{ companyId: selectedCompanyId }}
            className="grid gap-4 md:grid-cols-2"
            itemClassName="rounded-lg border bg-card p-4 shadow-sm"
          />

          <div className="grid md:grid-cols-2 gap-4">
            {/* Recent Activity — grouped by day, up to 20 items */}
            {recentActivity.length > 0 && (
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                  Recent Activity
                </h3>
                <div className="border border-border rounded-xl overflow-hidden">
                  {activityGroups.map((group) => (
                    <div key={group.label}>
                      <div className="px-4 py-1.5 bg-muted/30 border-b border-border">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {group.label}
                        </span>
                      </div>
                      <div className="divide-y divide-border">
                        {group.items.map((event) => (
                          <ActivityRow
                            key={event.id}
                            event={event}
                            agentMap={agentMap}
                            entityNameMap={entityNameMap}
                            entityTitleMap={entityTitleMap}
                            className={
                              animatedActivityIds.has(event.id)
                                ? "activity-row-enter"
                                : undefined
                            }
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Tasks */}
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Recent Tasks
              </h3>
              {recentIssues.length === 0 ? (
                <div className="border border-border rounded-xl p-4">
                  <p className="text-sm text-muted-foreground">No tasks yet.</p>
                </div>
              ) : (
                <div className="border border-border rounded-xl divide-y divide-border overflow-hidden">
                  {recentIssues.slice(0, 10).map((issue) => (
                    <Link
                      key={issue.id}
                      to={`/issues/${issue.identifier ?? issue.id}`}
                      className="px-4 py-3 text-sm cursor-pointer hover:bg-accent/50 transition-colors no-underline text-inherit block"
                    >
                      <div className="flex items-start gap-2 sm:items-center sm:gap-3">
                        <span className="shrink-0 sm:hidden">
                          <StatusIcon status={issue.status} />
                        </span>

                        <span className="flex min-w-0 flex-1 flex-col gap-1 sm:contents">
                          <span className="line-clamp-2 text-sm sm:order-2 sm:flex-1 sm:min-w-0 sm:line-clamp-none sm:truncate">
                            {issue.title}
                          </span>
                          <span className="flex items-center gap-2 sm:order-1 sm:shrink-0">
                            <span className="hidden sm:inline-flex">
                              <StatusIcon status={issue.status} />
                            </span>
                            <span className="text-xs font-mono text-muted-foreground">
                              {issue.identifier ?? issue.id.slice(0, 8)}
                            </span>
                            {issue.priority && priorityBadgeClass[issue.priority] && (
                              <Badge
                                variant="outline"
                                className={cn(
                                  "hidden sm:inline-flex text-[10px] px-1.5 py-0 h-4",
                                  priorityBadgeClass[issue.priority] ?? priorityBadgeClass.low,
                                )}
                              >
                                {issue.priority}
                              </Badge>
                            )}
                            {issue.assigneeAgentId && (() => {
                              const name = agentName(issue.assigneeAgentId);
                              return name ? (
                                <span className="hidden sm:inline-flex">
                                  <Identity name={name} size="sm" />
                                </span>
                              ) : null;
                            })()}
                            <span className="text-xs text-muted-foreground sm:hidden">&middot;</span>
                            <span className="text-xs text-muted-foreground shrink-0 sm:order-last">
                              {timeAgo(issue.updatedAt)}
                            </span>
                          </span>
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
