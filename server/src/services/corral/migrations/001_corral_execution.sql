-- Corral execution engine schema (spec §9 data model, §6.3 job runner).
--
-- BOUNDARY: every table is prefixed `corral_` and is independent of the
-- inherited Coral/Tovira tables (users, points, referrals, telegram). Corral
-- execution paths must never join to gamification tables (CLAUDE.md §8.4).
--
-- THE DATABASE IS A MIRROR. Chain state is authoritative for anything about
-- money (CLAUDE.md §3). Rows here exist to schedule work, prevent double
-- execution, and render history — never to decide whether a spend is allowed.
--
-- Money columns are numeric(78,0): base units, never bigint, never float
-- (2^256-1 has 78 digits).

-- ─────────────────────────────────────────────────────────────────────────
-- Sessions: the local mirror of an installed, verified on-chain session.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corral_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id          integer     NOT NULL,
  account           text        NOT NULL,                 -- ERC-7579 account (lowercase hex)
  owner             text        NOT NULL,
  agent_signer      text        NOT NULL,                 -- session signer address
  permission_id     text        NOT NULL,                 -- SmartSessions permissionId (0x…32 bytes)
  -- The exact policy the user signed, in @corral/core wire form. Used to
  -- re-derive the expectation model for verification and reconciliation.
  policy            jsonb       NOT NULL,
  -- PENDING_INSTALL → ACTIVE only after post-install read-back verification
  -- (CLAUDE.md §2.2). PAUSED_* are safety states resolved by a human.
  status            text        NOT NULL DEFAULT 'PENDING_INSTALL'
                    CHECK (status IN ('PENDING_INSTALL','ACTIVE','PAUSED_MISMATCH','PAUSED_DRIFT',
                                      'PAUSED_MODULE_CHANGE','REVOKED','EXPIRED','INSTALL_FAILED')),
  -- Off-chain kill switch (FR-8.2): set the instant a revoke is requested,
  -- before any on-chain confirmation. The signer and relayer both refuse
  -- while this is true, so revocation does not wait on a block.
  signer_disabled   boolean     NOT NULL DEFAULT false,
  signer_disabled_at timestamptz,
  install_tx        text,
  revoke_tx         text,
  valid_after       bigint      NOT NULL,
  valid_until       bigint      NOT NULL,
  verified_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_id, account, permission_id)
);
CREATE INDEX IF NOT EXISTS corral_sessions_active_idx ON corral_sessions (status) WHERE status = 'ACTIVE';

-- ─────────────────────────────────────────────────────────────────────────
-- Strategies: recurring rules that produce Plans (FR-9.x).
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corral_strategies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid        NOT NULL REFERENCES corral_sessions(id) ON DELETE CASCADE,
  kind              text        NOT NULL CHECK (kind IN ('DCA_FIXED','DCA_PERCENT','PRICE_CONDITIONAL')),
  config            jsonb       NOT NULL,                 -- venue, pair, amount, interval …
  status            text        NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT','ACTIVE','PAUSED','COMPLETED','EXPIRED','REVOKED')),
  interval_seconds  integer     NOT NULL CHECK (interval_seconds > 0),
  next_run_at       timestamptz NOT NULL,
  last_run_at       timestamptz,
  runs_completed    integer     NOT NULL DEFAULT 0,
  seq               integer     NOT NULL DEFAULT 0,       -- monotonic per strategy; part of the journal entry
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS corral_strategies_due_idx
  ON corral_strategies (next_run_at) WHERE status = 'ACTIVE';

-- ─────────────────────────────────────────────────────────────────────────
-- Executions: the ledger. THE COMMIT POINT (spec §7 step 8).
--
-- `idempotency_key` is written BEFORE anything is signed. Its UNIQUE
-- constraint IS the concurrency control: a second attempt for the same
-- (session, strategy, scheduled slot, seq) cannot insert, so it cannot sign,
-- so it cannot double-execute (NFR-7). Death after this point is recoverable
-- by reading the row and reconciling with the chain — never by re-planning.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corral_executions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid        NOT NULL REFERENCES corral_sessions(id) ON DELETE CASCADE,
  strategy_id       uuid        REFERENCES corral_strategies(id) ON DELETE SET NULL,
  idempotency_key   text        NOT NULL UNIQUE,
  seq               integer     NOT NULL,
  scheduled_for     timestamptz NOT NULL,
  status            text        NOT NULL DEFAULT 'PLANNED'
                    CHECK (status IN ('PLANNED','SIMULATED','SUBMITTED','INCLUDED','SUCCEEDED',
                                      'FAILED','REJECTED','ABORTED','EXPIRED')),
  plan              jsonb,                                -- @corral/core Plan wire form
  intent_hash       text,
  call_data_hash    text,                                 -- keccak of compiled calldata (FR-4.8)
  user_op_hash      text,
  tx_hash           text,
  block_number      bigint,
  gas_used          numeric(78,0),
  asset_in          text,
  amount_in         numeric(78,0),
  asset_out         text,
  quoted_out        numeric(78,0),
  realised_out      numeric(78,0),
  slippage_bps      integer,
  venue             text,
  error_code        text,                                 -- @corral/core ErrorCode
  error_detail      text,
  attempts          integer     NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS corral_executions_session_idx ON corral_executions (session_id, created_at DESC);
-- Rows the recovery job resolves (spec §6.3 execution.recover).
CREATE INDEX IF NOT EXISTS corral_executions_inflight_idx
  ON corral_executions (updated_at) WHERE status IN ('SIMULATED','SUBMITTED');

-- ─────────────────────────────────────────────────────────────────────────
-- Budget mirror: per-asset spend as last read FROM CHAIN. Never authoritative.
-- Drift beyond zero pauses the session (FR-6.3) rather than proceeding.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corral_budget_mirror (
  session_id        uuid        NOT NULL REFERENCES corral_sessions(id) ON DELETE CASCADE,
  asset             text        NOT NULL,
  limit_amount      numeric(78,0) NOT NULL,
  spent_amount      numeric(78,0) NOT NULL,
  usage_used        integer     NOT NULL DEFAULT 0,
  usage_limit       integer     NOT NULL DEFAULT 0,
  read_at           timestamptz NOT NULL DEFAULT now(),   -- freshness, shown in the UI (FR-6.4)
  PRIMARY KEY (session_id, asset)
);

-- ─────────────────────────────────────────────────────────────────────────
-- Jobs: Postgres queue (spec §6.3). Claim = FOR UPDATE SKIP LOCKED with a
-- per-session concurrency of exactly 1.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corral_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              text        NOT NULL,
  session_id        uuid        REFERENCES corral_sessions(id) ON DELETE CASCADE,
  payload           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status            text        NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','RUNNING','DONE','DEAD')),
  run_at            timestamptz NOT NULL DEFAULT now(),
  attempt           integer     NOT NULL DEFAULT 0,
  max_attempts      integer     NOT NULL DEFAULT 5,
  locked_at         timestamptz,
  locked_by         text,
  last_error        text,
  -- Optional idempotency for enqueue: a partial unique index keeps one live
  -- job per key, so a scheduler tick that runs twice enqueues once.
  dedupe_key        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS corral_jobs_pending_idx ON corral_jobs (run_at) WHERE status = 'PENDING';
-- Per-session concurrency of 1, enforced STRUCTURALLY rather than by the
-- claim query alone. The spec's draft claim (a NOT EXISTS check over RUNNING
-- rows) races: two workers can lock two different PENDING rows for the same
-- session, both observe "no RUNNING row", and both claim. This unique index
-- makes a second RUNNING row for a session unrepresentable — the loser gets
-- a 23505 and simply claims nothing. The claim query also takes a per-session
-- advisory lock so that path is rare, not load-bearing.
CREATE UNIQUE INDEX IF NOT EXISTS corral_jobs_one_running_per_session_idx
  ON corral_jobs (session_id) WHERE status = 'RUNNING' AND session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS corral_jobs_dedupe_idx
  ON corral_jobs (dedupe_key) WHERE dedupe_key IS NOT NULL AND status IN ('PENDING','RUNNING');

-- ─────────────────────────────────────────────────────────────────────────
-- Anomalies: SEC-9. Every entry is a human-facing safety event.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corral_anomalies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid        REFERENCES corral_sessions(id) ON DELETE CASCADE,
  kind              text        NOT NULL,                 -- MIRROR_DRIFT | MODULE_SET_CHANGED | …
  detail            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS corral_anomalies_open_idx
  ON corral_anomalies (created_at DESC) WHERE acknowledged_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- Signer audit (spec §6.1, SEC-13): append-only record of every signing
-- request and its outcome, including refusals. A compromised planner
-- hammering the signer must be visible, not silent.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corral_signer_audit (
  id          bigserial PRIMARY KEY,
  session_id  uuid        NOT NULL,
  op_hash     text        NOT NULL,
  requester   text        NOT NULL,
  outcome     text        NOT NULL,   -- SIGNED | REFUSED_REVOKED | REFUSED_INELIGIBLE | REFUSED_WRONG_SIGNER | REFUSED_UNKNOWN_SESSION
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS corral_signer_audit_session_idx ON corral_signer_audit (session_id, created_at DESC);
