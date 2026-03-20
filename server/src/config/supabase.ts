// src/config/supabase.ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

let supabaseClient: SupabaseClient | null = null;

export const getSupabaseClient = (): SupabaseClient => {
  if (!supabaseClient) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error(
        "Missing SUPABASE_URL or SUPABASE_KEY environment variables",
      );
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
