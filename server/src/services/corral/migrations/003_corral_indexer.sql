-- 003: the indexer — event projection and its cursor (C-701, I-501, FR-7.1/7.2/7.3)
--
-- The feed is rebuilt from chain logs, not from what we believed we
-- submitted. That distinction is the whole point: our records say what we
-- intended, the chain says what happened, and the only one worth showing a
-- user is the second.

-- Where the indexer has reached, per chain. The block hash is stored so a
-- reorg is *detected* rather than silently skipped: if the chain no longer
-- agrees about the block we last indexed, we rewind instead of continuing
-- from a history that no longer exists.
CREATE TABLE IF NOT EXISTS corral_indexer_cursor (
  chain_id     bigint      PRIMARY KEY,
  block_number bigint      NOT NULL,
  block_hash   text        NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Projected events, in the @corral/core CorralEvent shape (FR-7.1).
CREATE TABLE IF NOT EXISTS corral_events (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id       bigint      NOT NULL,
  account        text        NOT NULL,
  session_id     uuid        REFERENCES corral_sessions(id) ON DELETE CASCADE,
  execution_id   uuid        REFERENCES corral_executions(id) ON DELETE CASCADE,
  kind           text        NOT NULL,
  occurred_at    timestamptz NOT NULL,
  block_number   bigint,
  block_hash     text,
  tx_hash        text,
  log_index      integer,
  -- The full CorralEvent wire form. One definition, one source of truth; the
  -- columns beside it exist only for indexing and joins.
  payload        jsonb       NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Re-indexing the same log must update, not duplicate. This is what makes the
-- poller safe to run repeatedly and safe to rewind.
CREATE UNIQUE INDEX IF NOT EXISTS corral_events_onchain_idx
  ON corral_events (chain_id, tx_hash, log_index)
  WHERE tx_hash IS NOT NULL AND log_index IS NOT NULL;

CREATE INDEX IF NOT EXISTS corral_events_account_idx ON corral_events (account, occurred_at DESC);
CREATE INDEX IF NOT EXISTS corral_events_session_idx ON corral_events (session_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS corral_events_block_idx   ON corral_events (chain_id, block_number);

-- Gas, recorded apart from every asset amount (FR-6.5). These sit next to
-- gas_used rather than inside the money columns on purpose: there is no query
-- that can add a gas figure to a spend without saying so explicitly.
ALTER TABLE corral_executions ADD COLUMN IF NOT EXISTS gas_price_wei numeric(78,0);
ALTER TABLE corral_executions ADD COLUMN IF NOT EXISTS gas_cost_wei  numeric(78,0);
ALTER TABLE corral_executions ADD COLUMN IF NOT EXISTS gas_paid_by   text
  CHECK (gas_paid_by IS NULL OR gas_paid_by IN ('ACCOUNT', 'SPONSOR'));
-- Block hash of the block the execution landed in, so a reorg that moves it
-- is detectable rather than merely surprising.
ALTER TABLE corral_executions ADD COLUMN IF NOT EXISTS block_hash text;
