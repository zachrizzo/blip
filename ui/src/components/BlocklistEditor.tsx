import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentsApi, type BlocklistRule, type CreateBlocklistRuleInput } from "../api/agents";
import { cn } from "../lib/utils";
import {
  FileX2,
  Terminal,
  Wrench,
  MessageSquareWarning,
  Plus,
  Trash2,
  Shield,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const RULE_TYPE_META: Record<string, { icon: typeof FileX2; label: string; placeholder: string }> = {
  file: { icon: FileX2, label: "File", placeholder: "*.env, production.yml, /infrastructure/**" },
  command: { icon: Terminal, label: "Command", placeholder: "rm -rf, git push --force, DROP TABLE" },
  tool: { icon: Wrench, label: "Tool", placeholder: "Bash, Write, delete_file" },
  custom: { icon: MessageSquareWarning, label: "Custom Rule", placeholder: "Never deploy to production without a PR" },
};

const PRESETS: { label: string; rules: CreateBlocklistRuleInput[] }[] = [
  {
    label: "No force push",
    rules: [{ ruleType: "command", pattern: "git push --force", description: "Prevent force pushes to any branch" }],
  },
  {
    label: "No env file changes",
    rules: [{ ruleType: "file", pattern: "*.env, .env.*", description: "Protect environment configuration files" }],
  },
  {
    label: "No destructive deletes",
    rules: [{ ruleType: "command", pattern: "rm -rf", description: "Prevent recursive force deletion" }],
  },
  {
    label: "No production deploys",
    rules: [{ ruleType: "custom", pattern: "Never deploy directly to production without creating a PR first", description: "Require PR for production deployments" }],
  },
  {
    label: "No database drops",
    rules: [{ ruleType: "command", pattern: "DROP TABLE, DROP DATABASE, TRUNCATE", description: "Protect database from destructive operations" }],
  },
];

interface BlocklistEditorProps {
  agentId?: string;
  companyId: string;
  title?: string;
}

export function BlocklistEditor({ agentId, companyId, title = "Blocklist Rules" }: BlocklistEditorProps) {
  const queryClient = useQueryClient();
  const queryKey = agentId ? ["blocklist", agentId] : ["companyBlocklist", companyId];

  const { data: rules, isLoading } = useQuery({
    queryKey,
    queryFn: () => agentId
      ? agentsApi.getBlocklist(agentId)
      : agentsApi.getCompanyBlocklist(companyId),
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateBlocklistRuleInput) =>
      agentId
        ? agentsApi.createBlocklistRule(agentId, data)
        : agentsApi.createCompanyBlocklistRule(companyId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const toggleMutation = useMutation({
    mutationFn: (rule: BlocklistRule) =>
      agentsApi.updateBlocklistRule(rule.id, { isActive: !rule.isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const deleteMutation = useMutation({
    mutationFn: (ruleId: string) => agentsApi.deleteBlocklistRule(ruleId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const [showAddForm, setShowAddForm] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [newRule, setNewRule] = useState<CreateBlocklistRuleInput>({
    ruleType: "file",
    pattern: "",
    description: "",
    enforcement: "block",
  });

  const handleAdd = () => {
    if (!newRule.pattern.trim()) return;
    createMutation.mutate(newRule, {
      onSuccess: () => {
        setNewRule({ ruleType: "file", pattern: "", description: "", enforcement: "block" });
        setShowAddForm(false);
      },
    });
  };

  const handlePreset = (preset: typeof PRESETS[number]) => {
    for (const rule of preset.rules) {
      createMutation.mutate(rule);
    }
    setShowPresets(false);
  };

  const activeRules = (rules ?? []).filter((r) => r.isActive);
  const inactiveRules = (rules ?? []).filter((r) => !r.isActive);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">{title}</h3>
          {activeRules.length > 0 && (
            <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-500">
              {activeRules.length} active
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPresets(!showPresets)}
              className="text-xs"
            >
              Common Rules
              <ChevronDown className="ml-1 h-3 w-3" />
            </Button>
            {showPresets && (
              <div className="absolute right-0 top-full z-10 mt-1 w-56 rounded-xl border border-border bg-popover p-1 shadow-lg">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => handlePreset(preset)}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-foreground hover:bg-accent"
                  >
                    <Plus className="h-3 w-3 text-muted-foreground" />
                    {preset.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddForm(!showAddForm)}
            className="text-xs"
          >
            <Plus className="mr-1 h-3 w-3" />
            Add Rule
          </Button>
        </div>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            {(["file", "command", "tool", "custom"] as const).map((type) => {
              const meta = RULE_TYPE_META[type];
              const Icon = meta.icon;
              return (
                <button
                  key={type}
                  onClick={() => setNewRule({ ...newRule, ruleType: type })}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                    newRule.ruleType === type
                      ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
                      : "border-border/50 text-muted-foreground hover:border-border",
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {meta.label}
                </button>
              );
            })}
          </div>

          <input
            value={newRule.pattern}
            onChange={(e) => setNewRule({ ...newRule, pattern: e.target.value })}
            placeholder={RULE_TYPE_META[newRule.ruleType]?.placeholder}
            className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/40 focus:border-cyan-500/30 focus:outline-none"
          />

          <input
            value={newRule.description ?? ""}
            onChange={(e) => setNewRule({ ...newRule, description: e.target.value })}
            placeholder="Description (optional)"
            className="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/40 focus:border-cyan-500/30 focus:outline-none"
          />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {(["block", "warn"] as const).map((level) => (
                <button
                  key={level}
                  onClick={() => setNewRule({ ...newRule, enforcement: level })}
                  className={cn(
                    "flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                    newRule.enforcement === level
                      ? level === "block"
                        ? "border-red-500/30 bg-red-500/10 text-red-500"
                        : "border-amber-500/30 bg-amber-500/10 text-amber-500"
                      : "border-border/50 text-muted-foreground hover:border-border",
                  )}
                >
                  {level === "block" ? <Shield className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                  {level === "block" ? "Block" : "Warn"}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowAddForm(false)} className="text-xs">
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={!newRule.pattern.trim() || createMutation.isPending}
                className="text-xs"
              >
                Add Rule
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Rules list */}
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading rules...</p>
      ) : (rules ?? []).length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/50 px-4 py-6 text-center">
          <Shield className="mx-auto h-6 w-6 text-muted-foreground/30" />
          <p className="mt-2 text-sm text-muted-foreground/60">No blocklist rules yet.</p>
          <p className="mt-1 text-xs text-muted-foreground/40">Add rules to constrain what this agent can do.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {activeRules.map((rule) => (
            <RuleRow
              key={rule.id}
              rule={rule}
              onToggle={() => toggleMutation.mutate(rule)}
              onDelete={() => deleteMutation.mutate(rule.id)}
            />
          ))}
          {inactiveRules.length > 0 && (
            <>
              <p className="pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/40">
                Disabled
              </p>
              {inactiveRules.map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  onToggle={() => toggleMutation.mutate(rule)}
                  onDelete={() => deleteMutation.mutate(rule.id)}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function RuleRow({
  rule,
  onToggle,
  onDelete,
}: {
  rule: BlocklistRule;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const meta = RULE_TYPE_META[rule.ruleType] ?? RULE_TYPE_META.custom;
  const Icon = meta.icon;

  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors",
        rule.isActive
          ? "border-border/50 bg-card/30"
          : "border-border/20 bg-card/10 opacity-50",
      )}
    >
      <button
        onClick={onToggle}
        className={cn(
          "shrink-0 rounded-md border p-1 transition-colors",
          rule.isActive
            ? rule.enforcement === "block"
              ? "border-red-500/20 bg-red-500/10 text-red-500"
              : "border-amber-500/20 bg-amber-500/10 text-amber-500"
            : "border-border/30 bg-muted/20 text-muted-foreground/40",
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn(
            "rounded px-1 py-0.5 text-[10px] font-medium uppercase",
            rule.enforcement === "block"
              ? "bg-red-500/10 text-red-500"
              : "bg-amber-500/10 text-amber-500",
          )}>
            {rule.enforcement}
          </span>
          <span className="rounded bg-muted/30 px-1 py-0.5 text-[10px] font-medium text-muted-foreground">
            {meta.label}
          </span>
          {!rule.agentId && (
            <span className="rounded bg-blue-500/10 px-1 py-0.5 text-[10px] font-medium text-blue-500">
              Company
            </span>
          )}
        </div>
        <p className="mt-1 truncate text-xs font-mono text-foreground/80">{rule.pattern}</p>
        {rule.description && (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground/60">{rule.description}</p>
        )}
      </div>

      <button
        onClick={onDelete}
        className="shrink-0 rounded-lg p-1.5 text-muted-foreground/30 opacity-0 transition-all hover:bg-red-500/10 hover:text-red-500 group-hover:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
