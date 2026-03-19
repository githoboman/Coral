-- Migration: create user_tokens table for HMAC-SHA256 server-side token auth
-- user_id is TEXT to match user_profiles(wallet_address) primary key

CREATE TABLE IF NOT EXISTS user_tokens (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT        NOT NULL REFERENCES user_profiles(wallet_address) ON DELETE CASCADE,
  token_hash   TEXT        NOT NULL UNIQUE,
  name         VARCHAR(255),
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_tokens_token_hash ON user_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_user_tokens_user_id    ON user_tokens(user_id);
