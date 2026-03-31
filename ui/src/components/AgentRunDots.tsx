import type { HeartbeatRun } from "@paperclipai/shared";
import { cn } from "@/lib/utils";

interface AgentRunDotsProps {
  runs: HeartbeatRun[];
  count?: number;
  className?: string;
}

export function AgentRunDots({ runs, count = 5, className }: AgentRunDotsProps) {
  const slots = Array.from({ length: count }, (_, i) => runs[i]);

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {slots.map((run, i) => (
        <span
          key={run?.id ?? i}
          className={cn(
            "h-1.5 w-1.5 rounded-full shrink-0",
            run === undefined
              ? "bg-muted-foreground/10"
              : run.status === "succeeded"
              ? "bg-emerald-500"
              : run.status === "failed" || run.status === "timed_out"
              ? "bg-red-500"
              : "bg-muted-foreground/30",
          )}
          title={run ? `${run.status} · ${new Date(run.createdAt).toLocaleString()}` : "No run"}
        />
      ))}
    </div>
  );
}
