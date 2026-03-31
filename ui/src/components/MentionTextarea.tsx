import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Hash, User } from "lucide-react";
import type { Agent, Issue } from "@paperclipai/shared";
import { agentsApi } from "../api/agents";
import { issuesApi } from "../api/issues";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";

interface MentionState {
  trigger: "@" | "#";
  query: string;
  startIndex: number;
}

interface MentionTextareaProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  companyId?: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Textarea with @ (agent) and # (issue) mention support.
 * Detects triggers, shows a floating dropdown, and inserts mentions as plain text.
 */
export function MentionTextarea({
  value,
  onChange,
  onSubmit,
  companyId,
  placeholder,
  className,
  disabled,
}: MentionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionState, setMentionState] = useState<MentionState | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // ── Data ────────────────────────────────────────────────────────────────
  const { data: agents = [] } = useQuery({
    queryKey: queryKeys.agents.list(companyId!),
    queryFn: () => agentsApi.list(companyId!),
    enabled: !!companyId && mentionState?.trigger === "@",
    staleTime: 30_000,
  });

  const { data: issueResults = [] } = useQuery({
    queryKey: queryKeys.issues.search(companyId!, mentionState?.query ?? ""),
    queryFn: () => issuesApi.list(companyId!, { q: mentionState?.query ?? "" }),
    enabled: !!companyId && mentionState?.trigger === "#" && (mentionState?.query.length ?? 0) >= 1,
    staleTime: 10_000,
  });

  // ── Filtered mention options ─────────────────────────────────────────────
  const mentionItems = useMemo(() => {
    if (!mentionState) return [];
    const q = mentionState.query.toLowerCase();
    if (mentionState.trigger === "@") {
      return agents
        .filter((a) => a.status !== "terminated" && a.name.toLowerCase().includes(q))
        .slice(0, 8)
        .map((a: Agent) => ({ key: a.id, label: a.name, sub: a.role ?? "", insertText: `@${a.name}` }));
    }
    return issueResults
      .slice(0, 8)
      .map((issue: Issue) => ({
        key: issue.id,
        label: issue.identifier ?? issue.id.slice(0, 8),
        sub: issue.title,
        insertText: `#${issue.identifier ?? issue.id.slice(0, 8)}`,
      }));
  }, [mentionState, agents, issueResults]);

  // Reset selected index when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [mentionItems.length, mentionState?.trigger]);

  // ── Mention detection ───────────────────────────────────────────────────
  const detectMention = useCallback((text: string, cursor: number) => {
    const before = text.slice(0, cursor);
    const match = before.match(/[@#]([^\s@#]*)$/);
    if (!match) { setMentionState(null); return; }
    const trigger = match[0][0] as "@" | "#";
    const query = match[1];
    const startIndex = before.length - match[0].length;
    setMentionState({ trigger, query, startIndex });
  }, []);

  // ── Insertion ───────────────────────────────────────────────────────────
  const insertMention = useCallback((insertText: string) => {
    if (!mentionState || !textareaRef.current) return;
    const cursor = textareaRef.current.selectionStart ?? value.length;
    const before = value.slice(0, mentionState.startIndex);
    const after = value.slice(cursor);
    const next = `${before}${insertText} ${after}`;
    onChange(next);
    setMentionState(null);
    // Restore focus and move cursor after the inserted mention + space
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      const pos = before.length + insertText.length + 1;
      ta.setSelectionRange(pos, pos);
    });
  }, [mentionState, value, onChange]);

  // ── Keyboard handler ────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionItems.length > 0 && mentionState) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % mentionItems.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + mentionItems.length) % mentionItems.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const item = mentionItems[selectedIndex];
        if (item) insertMention(item.insertText);
        return;
      }
      if (e.key === "Escape") {
        setMentionState(null);
        return;
      }
    }

    // Normal submit (no mention dropdown open)
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  }, [mentionItems, mentionState, selectedIndex, insertMention, onSubmit]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    detectMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
    // Auto-resize
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 128) + "px";
  }, [onChange, detectMention]);

  const handleSelect = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) detectMention(ta.value, ta.selectionStart);
  }, [detectMention]);

  const showDropdown = mentionItems.length > 0 && mentionState !== null;

  return (
    <div className="relative flex-1">
      {/* Mention dropdown */}
      {showDropdown && (
        <div className="absolute bottom-full left-0 right-0 mb-1 z-10 rounded-xl border border-border bg-background shadow-lg overflow-hidden">
          {mentionItems.map((item, idx) => (
            <button
              key={item.key}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); insertMention(item.insertText); }}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors",
                idx === selectedIndex ? "bg-accent" : "hover:bg-accent/50",
              )}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-muted-foreground">
                {mentionState?.trigger === "@" ? (
                  <User className="h-3 w-3" />
                ) : (
                  <Hash className="h-3 w-3" />
                )}
              </span>
              <span className="text-sm font-medium text-foreground truncate">{item.label}</span>
              {item.sub && (
                <span className="text-xs text-muted-foreground/60 truncate min-w-0 flex-1">{item.sub}</span>
              )}
            </button>
          ))}
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onSelect={handleSelect}
        onClick={handleSelect}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        className={className}
        style={{ height: "auto", minHeight: "44px" }}
      />
    </div>
  );
}
