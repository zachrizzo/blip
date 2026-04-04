import { useState, useEffect, useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@/lib/router";
import { companiesApi } from "../api/companies";
import { agentsApi } from "../api/agents";
import { goalsApi } from "../api/goals";
import { AgentConfigForm } from "../components/AgentConfigForm";
import { AgentChatView } from "../components/AgentChatView";
import { defaultCreateValues } from "../components/agent-config-defaults";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import { queryKeys } from "../lib/queryKeys";
import { useCompany } from "../context/CompanyContext";
import { Button } from "@/components/ui/button";
import { cn } from "../lib/utils";
import {
  CheckCircle2,
  Bot,
  Building2,
  Target,
  Loader2,
  Users,
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  X,
} from "lucide-react";
import { adapterLabels } from "../components/agent-config-primitives";
import type { Agent, Company, Goal } from "@paperclipai/shared";

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage = 1 | 2 | 3;

// ─── Progress bar ─────────────────────────────────────────────────────────────

function StageBar({ stage, onGoToStage }: { stage: Stage; onGoToStage?: (s: Stage) => void }) {
  const stages = [
    { n: 1 as Stage, label: "Create Agent" },
    { n: 2 as Stage, label: "Set Up" },
    { n: 3 as Stage, label: "Review" },
  ];

  return (
    <div className="flex items-center gap-0">
      {stages.map((s, i) => {
        const completed = stage > s.n;
        const canNavigate = completed && onGoToStage;
        return (
          <div key={s.n} className="flex items-center">
            <button
              type="button"
              disabled={!canNavigate}
              onClick={() => canNavigate && onGoToStage(s.n)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition-colors rounded-md",
                stage === s.n
                  ? "text-foreground"
                  : completed
                    ? "text-muted-foreground hover:text-foreground hover:bg-accent/50 cursor-pointer"
                    : "text-muted-foreground/50 cursor-default",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold",
                  completed
                    ? "bg-primary text-primary-foreground"
                    : stage === s.n
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {completed ? <CheckCircle2 className="h-3 w-3" /> : s.n}
              </span>
              {s.label}
            </button>
            {i < stages.length - 1 && (
              <ChevronRight className="h-4 w-4 text-muted-foreground/40" />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Stage 1: Create Agent ────────────────────────────────────────────────────

function Stage1({
  company,
  onComplete,
}: {
  company: Company;
  onComplete: (agentId: string, agentName: string) => void;
}) {
  const queryClient = useQueryClient();
  const [companyName, setCompanyName] = useState(
    company.name === "New Workspace" ? "" : company.name,
  );
  const [agentName, setAgentName] = useState("");
  const [agentRole, setAgentRole] = useState("general");
  const [values, setValues] = useState<CreateConfigValues>({ ...defaultCreateValues });
  const [error, setError] = useState<string | null>(null);

  const { data: adapterModels } = useQuery({
    queryKey: queryKeys.agents.adapterModels(company.id, values.adapterType as string),
    queryFn: () => agentsApi.adapterModels(company.id, values.adapterType as string),
    enabled: Boolean(values.adapterType),
  });

  const updateNameMutation = useMutation({
    mutationFn: (name: string) => companiesApi.update(company.id, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.companies.all }),
  });

  const createAgentMutation = useMutation({
    mutationFn: async () => {
      // Update company name if changed
      const finalName = companyName.trim() || "My Workspace";
      if (finalName !== company.name) {
        await companiesApi.update(company.id, { name: finalName });
      }

      return agentsApi.create(company.id, {
        name: agentName.trim() || "My Agent",
        role: agentRole.trim() || "general",
        adapterType: values.adapterType,
        adapterConfig: {
          model: values.model || undefined,
          command: values.command || undefined,
          args: values.args || undefined,
          url: values.url || undefined,
        },
        runtimeConfig: {
          heartbeat: {
            enabled: true,
            interval: 3600,
          },
        },
      });
    },
    onSuccess: (agent: Agent) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(company.id) });
      onComplete(agent.id, agent.name);
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : "Failed to create agent");
    },
  });

  const canContinue =
    companyName.trim().length > 0 &&
    agentName.trim().length > 0 &&
    Boolean(values.adapterType);

  return (
    <div className="flex flex-col gap-6">
      {/* Company name */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-foreground">
          Workspace name
        </label>
        <input
          type="text"
          className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
          placeholder="My Team"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          onBlur={() => {
            const name = companyName.trim();
            if (name && name !== company.name) {
              updateNameMutation.mutate(name);
            }
          }}
        />
      </div>

      <hr className="border-border" />

      {/* Agent identity */}
      <div className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-foreground">Create your first agent</h2>
        <div className="flex gap-4">
          <div className="flex-1 flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Agent name</label>
            <input
              type="text"
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
              placeholder="Alex"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
            />
          </div>
          <div className="flex-1 flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Role</label>
            <input
              type="text"
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
              placeholder="engineer, manager, analyst…"
              value={agentRole}
              onChange={(e) => setAgentRole(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Adapter config */}
      <div>
        <h3 className="mb-4 text-sm font-medium text-muted-foreground">Adapter configuration</h3>
        <AgentConfigForm
          mode="create"
          values={values}
          onChange={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
          adapterModels={adapterModels}
          showAdapterTypeField
          showAdapterTestEnvironmentButton
          hideInstructionsFile
          hidePromptTemplate
          showCreateRunPolicySection={false}
        />
      </div>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <div className="flex justify-end">
        <Button
          disabled={!canContinue || createAgentMutation.isPending}
          onClick={() => createAgentMutation.mutate()}
        >
          {createAgentMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Creating…
            </>
          ) : (
            "Continue"
          )}
        </Button>
      </div>
    </div>
  );
}

// ─── Stage 2: Chat Setup ──────────────────────────────────────────────────────

function Stage2({
  company,
  agentId,
  agentName,
  onContinue,
}: {
  company: Company;
  agentId: string;
  agentName: string;
  onContinue: () => void;
}) {
  const [threadId, setThreadId] = useState<string | null>(null);
  const setupStartedRef = useRef(false);

  // Poll company every 3s to detect when agent calls finish_onboarding
  const { data: freshCompany } = useQuery({
    queryKey: queryKeys.companies.detail(company.id),
    queryFn: () => companiesApi.get(company.id),
    refetchInterval: 3000,
  });

  const isOnboardingComplete = freshCompany?.onboardingComplete ?? false;

  // Start the onboarding chat — backend creates thread, generates prompt, wakes agent.
  // useRef guard prevents double-invocation from React Strict Mode or dep changes.
  useEffect(() => {
    if (setupStartedRef.current) return;
    setupStartedRef.current = true;
    companiesApi.onboardingStart(company.id, agentId).then(({ threadId: tid }) => {
      setThreadId(tid);
    }).catch(() => {
      // Non-fatal — user can still chat manually
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Bot className="h-4 w-4" />
          <span>
            Chat with <strong className="text-foreground">{agentName}</strong> to finish setting up{" "}
            <strong className="text-foreground">{company.name}</strong>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isOnboardingComplete && (
            <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Setup complete
            </span>
          )}
          <Button
            variant={isOnboardingComplete ? "default" : "outline"}
            size="sm"
            onClick={onContinue}
          >
            {isOnboardingComplete ? "Review & Finish" : "Continue to Review"}
          </Button>
        </div>
      </div>

      {/* Chat */}
      <div className="flex-1 overflow-hidden">
        {threadId ? (
          <AgentChatView
            agentId={agentId}
            agentName={agentName}
            companyId={company.id}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Starting conversation…
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Stage 3: Summary & Finish ────────────────────────────────────────────────

function Stage3({
  company,
  onFinish,
}: {
  company: Company;
  onFinish: () => void;
}) {
  const { data: freshCompany } = useQuery({
    queryKey: queryKeys.companies.detail(company.id),
    queryFn: () => companiesApi.get(company.id),
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(company.id),
    queryFn: () => agentsApi.list(company.id),
  });

  const { data: goals } = useQuery({
    queryKey: queryKeys.goals.list(company.id),
    queryFn: () => goalsApi.list(company.id),
  });

  const displayCompany = freshCompany ?? company;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold">Your workspace is ready</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Here's everything that was set up.
        </p>
      </div>

      {/* Company card */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Workspace</span>
        </div>
        <p className="text-base font-semibold">{displayCompany.name}</p>
        {displayCompany.description && (
          <p className="mt-1 text-sm text-muted-foreground">{displayCompany.description}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
          {displayCompany.industry && (
            <span>Industry: {displayCompany.industry}</span>
          )}
          {displayCompany.teamSize && (
            <span>Team size: {displayCompany.teamSize}</span>
          )}
          {displayCompany.primaryUseCase && (
            <span>Use case: {displayCompany.primaryUseCase}</span>
          )}
        </div>
      </div>

      {/* Agents */}
      {agents && agents.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">
              Agents ({agents.length})
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {agents.map((agent: Agent) => (
              <AgentReviewCard key={agent.id} agent={agent} />
            ))}
          </div>
        </div>
      )}

      {/* Goals */}
      {goals && goals.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Goals ({goals.length})</span>
          </div>
          <div className="flex flex-col gap-2">
            {(goals as Goal[]).map((goal: Goal) => (
              <div
                key={goal.id}
                className="flex items-start gap-2 rounded-md bg-muted/40 px-3 py-2"
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{goal.title}</p>
                  {goal.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                      {goal.description}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={onFinish} size="lg">
          Go to Dashboard
        </Button>
      </div>
    </div>
  );
}

// ─── Expandable Agent Card ───────────────────────────────────────────────────

function AgentReviewCard({ agent }: { agent: Agent }) {
  const [expanded, setExpanded] = useState(false);
  const config = agent.adapterConfig ?? {};
  const heartbeat = (agent.runtimeConfig as Record<string, unknown>)?.heartbeat as
    | { enabled?: boolean; interval?: number }
    | undefined;

  return (
    <div className="rounded-md border border-border/50 bg-muted/40 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/30 transition-colors"
      >
        <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{agent.name}</p>
          {(agent.role || agent.title) && (
            <p className="text-xs text-muted-foreground">
              {agent.title ?? agent.role}
            </p>
          )}
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {adapterLabels[agent.adapterType] ?? agent.adapterType}
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>
      {expanded && (
        <div className="border-t border-border/30 px-3 py-3 grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
          <div>
            <span className="text-muted-foreground">Adapter</span>
            <p className="font-medium">{adapterLabels[agent.adapterType] ?? agent.adapterType}</p>
          </div>
          {config.model && (
            <div>
              <span className="text-muted-foreground">Model</span>
              <p className="font-medium">{String(config.model)}</p>
            </div>
          )}
          {config.command && (
            <div>
              <span className="text-muted-foreground">Command</span>
              <p className="font-mono font-medium">{String(config.command)}</p>
            </div>
          )}
          <div>
            <span className="text-muted-foreground">Heartbeat</span>
            <p className="font-medium">
              {heartbeat?.enabled
                ? `Every ${Math.round((heartbeat.interval ?? 3600) / 60)}m`
                : "Disabled"}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Status</span>
            <p className="font-medium capitalize">{agent.status}</p>
          </div>
          {config.promptTemplate && (
            <div className="col-span-2">
              <span className="text-muted-foreground">Prompt Template</span>
              <p className="font-mono text-[11px] mt-1 p-2 rounded bg-background border border-border/30 line-clamp-3 whitespace-pre-wrap">
                {String(config.promptTemplate).slice(0, 200)}
                {String(config.promptTemplate).length > 200 ? "…" : ""}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main OnboardingPage ──────────────────────────────────────────────────────

export function OnboardingPage() {
  const { companyId } = useParams<{ companyId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setSelectedCompanyId } = useCompany();

  const [stage, setStage] = useState<Stage>(1);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [agentName, setAgentName] = useState<string>("");

  const { data: company, isLoading } = useQuery({
    queryKey: queryKeys.companies.detail(companyId!),
    queryFn: () => companiesApi.get(companyId!),
    enabled: Boolean(companyId),
  });

  // Check if user already has other companies (show cancel button if so)
  const { data: allCompanies } = useQuery({
    queryKey: queryKeys.companies.all,
    queryFn: () => companiesApi.list(),
  });
  const hasOtherCompanies = (allCompanies ?? []).filter(
    (c) => c.id !== companyId && !c.archived,
  ).length > 0;

  const handleStage1Complete = useCallback(
    (id: string, name: string) => {
      setAgentId(id);
      setAgentName(name);
      setStage(2);
    },
    [],
  );

  const handleCancel = useCallback(() => {
    // Delete the placeholder company and go back
    if (companyId) {
      companiesApi.remove(companyId).catch(() => {});
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    }
    navigate("/");
  }, [companyId, navigate, queryClient]);

  const handleFinish = useCallback(() => {
    if (company) {
      setSelectedCompanyId(company.id, { source: "manual" });
      navigate(`/${company.issuePrefix}/dashboard`);
    }
  }, [company, navigate, setSelectedCompanyId]);

  if (isLoading || !company) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-3">
          {/* Back button for stages 2 & 3 */}
          {stage > 1 && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setStage((stage - 1) as Stage)}
              title="Go back"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          <span className="text-sm font-semibold text-foreground">
            {company.name === "New Workspace" ? "New Workspace" : company.name}
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="text-xs text-muted-foreground">Setup</span>
        </div>
        <StageBar stage={stage} onGoToStage={(s) => setStage(s)} />
        <div className="flex items-center gap-2 w-40 justify-end">
          {/* Cancel button — deletes placeholder company and exits */}
          {hasOtherCompanies && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleCancel}
              title="Cancel setup"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </header>

      {/* Content */}
      <main
        className={cn(
          "flex-1 overflow-auto",
          stage === 2 ? "overflow-hidden" : "",
        )}
      >
        {stage === 1 && (
          <div className="mx-auto max-w-2xl px-6 py-10">
            <h1 className="mb-6 text-2xl font-semibold">
              Create your first agent
            </h1>
            <Stage1 company={company} onComplete={handleStage1Complete} />
          </div>
        )}

        {stage === 2 && agentId && (
          <div className="flex h-full flex-col">
            <Stage2
              company={company}
              agentId={agentId}
              agentName={agentName}
              onContinue={() => setStage(3)}
            />
          </div>
        )}

        {stage === 3 && (
          <div className="mx-auto max-w-2xl px-6 py-10">
            <Stage3 company={company} onFinish={handleFinish} />
          </div>
        )}
      </main>
    </div>
  );
}

// ─── OnboardingNewRedirect ─────────────────────────────────────────────────────
// Creates a placeholder company and redirects to /onboarding/:companyId

export function OnboardingNewRedirect() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const createMutation = useMutation({
    mutationFn: () => companiesApi.create({ name: "New Workspace" }),
    onSuccess: (company) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      navigate(`/onboarding/${company.id}`, { replace: true });
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : "Failed to create workspace");
    },
  });

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    createMutation.mutate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4">
        <p className="text-sm text-destructive">{error}</p>
        <Button onClick={() => createMutation.mutate()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
