import type { AdapterModel } from "./types.js";
import { models as claudeFallbackModels, bedrockModels as claudeBedrockModels } from "@paperclipai/adapter-claude-local";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ANTHROPIC_MODELS_ENDPOINT = "https://api.anthropic.com/v1/models";
const ANTHROPIC_MODELS_TIMEOUT_MS = 5000;
const ANTHROPIC_MODELS_CACHE_TTL_MS = 60_000;

let cached: { keyFingerprint: string; expiresAt: number; models: AdapterModel[] } | null = null;

function fingerprint(key: string): string {
  return `${key.length}:${key.slice(-6)}`;
}

function dedupeModels(models: AdapterModel[]): AdapterModel[] {
  const seen = new Set<string>();
  const deduped: AdapterModel[] = [];
  for (const model of models) {
    const id = model.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const entry: AdapterModel = { id, label: model.label.trim() || id };
    if (model.contextWindow !== undefined) entry.contextWindow = model.contextWindow;
    deduped.push(entry);
  }
  return deduped;
}

function mergedWithFallback(fetched: AdapterModel[]): AdapterModel[] {
  return dedupeModels([...fetched, ...claudeFallbackModels]).sort((a, b) =>
    a.id.localeCompare(b.id, "en", { numeric: true, sensitivity: "base" }),
  );
}

function claudeConfigDir(): string {
  const fromEnv = process.env.CLAUDE_CONFIG_DIR;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return fromEnv.trim();
  return path.join(os.homedir(), ".claude");
}

function extractOAuthToken(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const oauth = (parsed as Record<string, unknown>)["claudeAiOauth"];
  if (typeof oauth !== "object" || oauth === null) return null;
  const token = (oauth as Record<string, unknown>)["accessToken"];
  return typeof token === "string" && token.length > 0 ? token : null;
}

async function readClaudeOAuthToken(): Promise<string | null> {
  // 1. Try credential files (~/.claude/.credentials.json / credentials.json)
  const configDir = claudeConfigDir();
  for (const filename of [".credentials.json", "credentials.json"]) {
    try {
      const raw = await fs.readFile(path.join(configDir, filename), "utf8");
      const token = extractOAuthToken(raw);
      if (token) return token;
    } catch {
      // not found, try next
    }
  }

  // 2. Fallback: macOS Keychain (Claude Code stores credentials here when no file exists)
  if (process.platform === "darwin") {
    try {
      const result = spawnSync(
        "security",
        ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
        { encoding: "utf8", timeout: 3000 },
      );
      if (result.status === 0 && result.stdout) {
        const token = extractOAuthToken(result.stdout.trim());
        if (token) return token;
      }
    } catch {
      // keychain unavailable
    }
  }

  return null;
}

type AuthHeaders = Record<string, string>;

async function resolveAuthHeaders(): Promise<{ headers: AuthHeaders; fp: string } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (apiKey) {
    return {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      fp: fingerprint(apiKey),
    };
  }
  const token = await readClaudeOAuthToken();
  if (token) {
    return {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "oauth-2025-04-20",
      },
      fp: fingerprint(token),
    };
  }
  return null;
}

async function fetchAnthropicModels(headers: AuthHeaders): Promise<AdapterModel[]> {
  const url = new URL(ANTHROPIC_MODELS_ENDPOINT);
  url.searchParams.set("limit", "100");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ANTHROPIC_MODELS_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), { headers, signal: controller.signal });
    if (!response.ok) return [];

    const payload = (await response.json()) as { data?: unknown };
    const data = Array.isArray(payload.data) ? payload.data : [];
    const models: AdapterModel[] = [];
    for (const item of data) {
      if (typeof item !== "object" || item === null) continue;
      const record = item as Record<string, unknown>;
      const id = record.id;
      if (typeof id !== "string" || !id.startsWith("claude-")) continue;
      const displayName = record.display_name;
      const label = typeof displayName === "string" && displayName.length > 0 ? displayName : id;
      const contextWindow = typeof record.max_input_tokens === "number" ? record.max_input_tokens : undefined;
      models.push({ id, label, ...(contextWindow !== undefined ? { contextWindow } : {}) });
    }
    return dedupeModels(models);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/** True when the server process is configured for AWS Bedrock. */
function isBedrockEnabled(): boolean {
  return (
    process.env.CLAUDE_CODE_USE_BEDROCK === "1" ||
    Boolean(process.env.AWS_BEDROCK_BASE_URL?.trim())
  );
}

export async function listClaudeModels(): Promise<AdapterModel[]> {
  const bedrock = isBedrockEnabled();

  const auth = await resolveAuthHeaders();

  // When no Anthropic auth is available, fall back to static lists.
  if (!auth) {
    const base = dedupeModels(claudeFallbackModels);
    return bedrock ? dedupeModels([...claudeBedrockModels, ...base]) : base;
  }

  const now = Date.now();
  if (cached && cached.keyFingerprint === auth.fp && cached.expiresAt > now) {
    const models = cached.models;
    return bedrock ? dedupeModels([...claudeBedrockModels, ...models]) : models;
  }

  const fetched = await fetchAnthropicModels(auth.headers);
  if (fetched.length > 0) {
    const merged = mergedWithFallback(fetched);
    cached = { keyFingerprint: auth.fp, expiresAt: now + ANTHROPIC_MODELS_CACHE_TTL_MS, models: merged };
    return bedrock ? dedupeModels([...claudeBedrockModels, ...merged]) : merged;
  }

  if (cached && cached.keyFingerprint === auth.fp && cached.models.length > 0) {
    const models = cached.models;
    return bedrock ? dedupeModels([...claudeBedrockModels, ...models]) : models;
  }

  const base = dedupeModels(claudeFallbackModels);
  return bedrock ? dedupeModels([...claudeBedrockModels, ...base]) : base;
}

export function resetClaudeModelsCacheForTests() {
  cached = null;
}
