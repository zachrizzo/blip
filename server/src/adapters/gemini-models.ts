import type { AdapterModel } from "./types.js";
import { models as geminiFallbackModels } from "@paperclipai/adapter-gemini-local";

const GOOGLE_MODELS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const GOOGLE_MODELS_TIMEOUT_MS = 5000;
const GOOGLE_MODELS_CACHE_TTL_MS = 60_000;

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
    deduped.push({ id, label: model.label.trim() || id });
  }
  return deduped;
}

function mergedWithFallback(fetched: AdapterModel[]): AdapterModel[] {
  return dedupeModels([...fetched, ...geminiFallbackModels]).sort((a, b) =>
    a.id.localeCompare(b.id, "en", { numeric: true, sensitivity: "base" }),
  );
}

function resolveGeminiApiKey(): string | null {
  const key = (process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim()) ?? "";
  return key.length > 0 ? key : null;
}

async function fetchGeminiModels(apiKey: string): Promise<AdapterModel[]> {
  const url = new URL(GOOGLE_MODELS_ENDPOINT);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("pageSize", "100");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GOOGLE_MODELS_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), { signal: controller.signal });
    if (!response.ok) return [];

    const payload = (await response.json()) as { models?: unknown };
    const items = Array.isArray(payload.models) ? payload.models : [];
    const models: AdapterModel[] = [];
    for (const item of items) {
      if (typeof item !== "object" || item === null) continue;
      const record = item as Record<string, unknown>;
      const name = record.name;
      if (typeof name !== "string") continue;
      const id = name.replace(/^models\//, "");
      if (!id.startsWith("gemini-")) continue;
      const displayName = record.displayName;
      const label = typeof displayName === "string" && displayName.length > 0 ? displayName : id;
      models.push({ id, label });
    }
    return dedupeModels(models);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function listGeminiModels(): Promise<AdapterModel[]> {
  const apiKey = resolveGeminiApiKey();
  if (!apiKey) return dedupeModels(geminiFallbackModels);

  const now = Date.now();
  const fp = fingerprint(apiKey);
  if (cached && cached.keyFingerprint === fp && cached.expiresAt > now) {
    return cached.models;
  }

  const fetched = await fetchGeminiModels(apiKey);
  if (fetched.length > 0) {
    const merged = mergedWithFallback(fetched);
    cached = { keyFingerprint: fp, expiresAt: now + GOOGLE_MODELS_CACHE_TTL_MS, models: merged };
    return merged;
  }

  if (cached && cached.keyFingerprint === fp && cached.models.length > 0) {
    return cached.models;
  }

  return dedupeModels(geminiFallbackModels);
}

export function resetGeminiModelsCacheForTests() {
  cached = null;
}
