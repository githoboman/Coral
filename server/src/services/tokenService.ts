import crypto from 'crypto';
import getSupabaseClient, { isSupabaseConfigured } from '../config/supabase';

const supabase = getSupabaseClient();

const HMAC_SECRET = process.env.TOKEN_HMAC_SECRET;
if (!HMAC_SECRET) {
  throw new Error('Missing TOKEN_HMAC_SECRET environment variable');
}

const TOKEN_EXPIRES_DAYS = parseInt(process.env.TOKEN_EXPIRES_DAYS || '7', 10);

// ---------------------------------------------------------------------------
// Core crypto helpers
// ---------------------------------------------------------------------------

/** Generate a cryptographically secure raw token (256-bit hex string). */
export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** Hash a raw token using HMAC-SHA256. Only this hash is stored in the DB. */
export function hashToken(rawToken: string): string {
  return crypto
    .createHmac('sha256', HMAC_SECRET as string)
    .update(rawToken)
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Stateless token mode (no database)
// ---------------------------------------------------------------------------
// When Supabase isn't configured (local/demo), session tokens can't be stored
// in a `user_tokens` table. Instead we mint a self-contained, HMAC-signed token
// of the form `st.<base64url(userId)>.<expiryMs>.<sig>` that validateToken can
// verify with no DB lookup. The HMAC secret is the same TOKEN_HMAC_SECRET.

const STATELESS_PREFIX = 'st';

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64url');
}
function unb64url(s: string): string {
  return Buffer.from(s, 'base64url').toString('utf8');
}

function signStateless(userId: string, expiresAtMs: number): string {
  return crypto
    .createHmac('sha256', HMAC_SECRET as string)
    .update(`${STATELESS_PREFIX}.${userId}.${expiresAtMs}`)
    .digest('hex');
}

function makeStatelessToken(userId: string, expiresAtMs: number): string {
  const sig = signStateless(userId, expiresAtMs);
  return `${STATELESS_PREFIX}.${b64url(userId)}.${expiresAtMs}.${sig}`;
}

/** Verify a stateless token; returns userId if valid+unexpired, else null. */
function validateStatelessToken(rawToken: string): string | null {
  const parts = rawToken.split('.');
  if (parts.length !== 4 || parts[0] !== STATELESS_PREFIX) return null;
  const [, encodedUser, expiryStr, sig] = parts;
  let userId: string;
  try {
    userId = unb64url(encodedUser);
  } catch {
    return null;
  }
  const expiresAtMs = Number(expiryStr);
  if (!Number.isFinite(expiresAtMs)) return null;
  const expected = signStateless(userId, expiresAtMs);
  // Constant-time compare to avoid timing leaks.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (expiresAtMs < Date.now()) return null;
  return userId;
}

// ---------------------------------------------------------------------------
// Token lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a new session token for a user.
 * Inserts a row into user_tokens and returns the raw token + expiry.
 * The raw token is NEVER stored — caller must send it to the client.
 */
export async function createToken(
  userId: string,
  name: string = 'Unknown device',
  expiresInDays: number = TOKEN_EXPIRES_DAYS,
): Promise<{ rawToken: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  // No DB configured -> issue a self-contained, HMAC-signed stateless token.
  if (!isSupabaseConfigured) {
    return { rawToken: makeStatelessToken(userId, expiresAt.getTime()), expiresAt };
  }

  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);

  const { error } = await supabase.from('user_tokens').insert({
    user_id: userId,
    token_hash: tokenHash,
    name,
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    throw new Error(`[tokenService] Failed to create token: ${error.message}`);
  }

  return { rawToken, expiresAt };
}

/**
 * Validate a raw token from the client.
 * - Hashes it and looks it up in the DB.
 * - Checks expiry.
 * - Bumps last_used_at on success.
 * Returns the user_id if valid, or null if invalid/expired.
 */
export async function validateToken(rawToken: string): Promise<string | null> {
  // Stateless tokens (no-DB mode) verify cryptographically without a lookup.
  if (rawToken.startsWith(`${STATELESS_PREFIX}.`)) {
    return validateStatelessToken(rawToken);
  }

  const tokenHash = hashToken(rawToken);

  const { data, error } = await supabase
    .from('user_tokens')
    .select('id, user_id, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error || !data) return null;

  if (new Date(data.expires_at) < new Date()) {
    // Expired — clean it up
    await supabase.from('user_tokens').delete().eq('id', data.id);
    return null;
  }

  // Update last_used_at (fire-and-forget, non-blocking)
  supabase
    .from('user_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(() => {});

  return data.user_id as string;
}

/**
 * Revoke a single token (logout current device).
 * Hashes the raw token and deletes the matching row.
 */
export async function revokeToken(rawToken: string): Promise<void> {
  if (!isSupabaseConfigured) return; // stateless tokens aren't stored
  const tokenHash = hashToken(rawToken);
  await supabase.from('user_tokens').delete().eq('token_hash', tokenHash);
}

/**
 * Revoke ALL tokens for a user (logout all devices).
 * Deletes every row in user_tokens where user_id matches.
 */
export async function revokeAllTokens(userId: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  await supabase.from('user_tokens').delete().eq('user_id', userId);
}

/**
 * Revoke all tokens for a specific user and device name.
 * Prevents growing piles of tokens per device.
 */
export async function revokeDeviceTokens(userId: string, name: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  await supabase.from('user_tokens').delete().eq('user_id', userId).eq('name', name);
}
