// src/config/supabase.ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

let supabaseClient: SupabaseClient | null = null;

/** True when the value looks like a real http(s) URL (not a placeholder). */
const isValidHttpUrl = (v: string | undefined): v is string => {
  if (!v) return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * True when real Supabase creds are configured. When false, the server runs on a
 * non-functional dummy client — DB-backed features (auth tokens, profiles) must
 * degrade gracefully (e.g. tokenService falls back to stateless HMAC tokens).
 */
export const isSupabaseConfigured: boolean =
  isValidHttpUrl(process.env.SUPABASE_URL) && !!process.env.SUPABASE_KEY;

export const getSupabaseClient = (): SupabaseClient => {
  if (!supabaseClient) {
    let supabaseUrl = process.env.SUPABASE_URL;
    let supabaseKey = process.env.SUPABASE_KEY;

    // No-database mode: when creds are absent/placeholders, build against a
    // syntactically-valid dummy endpoint so the server still BOOTS. Coral's
    // agent-wallet flow doesn't use Supabase — auth runs on stateless HMAC tokens
    // and the agent store falls back to memory — so this is a supported mode.
    const configured = isValidHttpUrl(supabaseUrl) && !!supabaseKey;
    const url: string = configured ? (supabaseUrl as string) : "https://placeholder.supabase.co";
    const key: string = configured ? (supabaseKey as string) : "placeholder-key";

    supabaseClient = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        fetch: fetch as any,
      },
    });

    if (configured) {
      console.log("✓ Supabase connected:", url.split("//")[1]?.split("/")[0]);
    } else {
      console.log("[startup] No-database mode — stateless auth + in-memory agent store (Supabase optional).");
    }
  }

  return supabaseClient;
};

export default getSupabaseClient;
