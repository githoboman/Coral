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

    // Dev/demo fallback: when creds are absent or placeholders, construct against a
    // syntactically-valid dummy endpoint so the server still BOOTS (e.g. for the
    // agent-wallet flow, which doesn't touch Supabase). Any actual DB call will fail
    // at request time, which is the intended behaviour without real creds.
    if (!isValidHttpUrl(supabaseUrl) || !supabaseKey) {
      console.warn(
        "[supabase] No valid SUPABASE_URL/KEY — using a non-functional dummy client. " +
          "DB-backed routes will error until real creds are set.",
      );
      supabaseUrl = "https://placeholder.supabase.co";
      supabaseKey = supabaseKey || "placeholder-key";
    }

    supabaseClient = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        fetch: fetch as any,
      },
    });

    console.log("✓ Supabase client initialized successfully");
    console.log("  URL:", supabaseUrl.split("//")[1]?.split("/")[0]); // Log host only
    console.log("  Key present:", !!supabaseKey);
  }

  return supabaseClient;
};

export default getSupabaseClient;
