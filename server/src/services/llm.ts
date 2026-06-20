import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

/**
 * Shared helpers for safely constructing the Gemini chat model.
 *
 * The server must boot and its services must construct even when no real
 * `GEMINI_API_KEY` is configured (CI, local dev, a demo box without creds).
 * `ChatGoogleGenerativeAI`'s constructor THROWS when no key is present, so every
 * service that wants an LLM should go through `createChatModel`, which returns
 * `null` instead of throwing when the key is missing or a placeholder. Callers
 * then degrade to their deterministic/regex fallback path.
 */

/** True when `key` looks like a real credential, not empty/placeholder. */
export function isUsableLlmKey(key: string | undefined | null): boolean {
  if (!key) return false;
  const k = key.trim();
  if (k.length < 10) return false;
  return !/^(dummy|test|changeme|placeholder|your[-_]?key|xxx+)/i.test(k);
}

/** Resolve the first usable Gemini key from the conventional env vars. */
export function resolveGeminiKey(...preferred: (string | undefined)[]): string | undefined {
  const candidates = [...preferred, process.env.GEMINI_API_KEY, process.env.GOOGLE_API_KEY];
  return candidates.find(isUsableLlmKey);
}

export interface ChatModelOptions {
  model?: string;
  temperature?: number;
  maxRetries?: number;
  maxOutputTokens?: number;
  /** Extra keys to try before the conventional env vars (e.g. a task-specific key). */
  apiKeyCandidates?: (string | undefined)[];
}

/**
 * Construct a `ChatGoogleGenerativeAI` if a usable key exists, else return null.
 * Never throws on a missing key — callers must handle the null (fallback) case.
 */
export function createChatModel(opts: ChatModelOptions = {}): ChatGoogleGenerativeAI | null {
  const apiKey = resolveGeminiKey(...(opts.apiKeyCandidates ?? []));
  if (!apiKey) return null;
  return new ChatGoogleGenerativeAI({
    model: opts.model || process.env.LLM_MODEL || "gemini-2.5-flash",
    apiKey,
    temperature: opts.temperature ?? 0,
    maxRetries: opts.maxRetries ?? 1,
    ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
  });
}
