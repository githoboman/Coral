-- 002: relayer nonce allocation and transaction tracking (I-402, I-403, I-405)
--
-- Ethereum transaction nonces are strictly sequential per sender. If nonce N
-- is allocated and never lands, every transaction after it is stuck behind a
-- hole — which means one abandoned submission stalls EVERY user at once.
-- That is why this is persisted rather than kept in memory: process restarts,
-- concurrent workers, and crashes between "allocate" and "send" must all be
-- recoverable, and none of them can be recovered from a variable.
--
-- Money columns stay numeric(78,0). Gas fees are wei and get the same
-- treatment as any other on-chain amount.

CREATE TABLE IF NOT EXISTS corral_relayer_nonces (
  chain_id     bigint      NOT NULL,
  relayer      text        NOT NULL,
  -- The next nonce we intend to hand out. Advanced only under the advisory
  -- lock, and never moved backwards: rewinding would replace a live tx.
  next_nonce   bigint      NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, relayer)
);

CREATE TABLE IF NOT EXISTS corral_relayer_txs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id      bigint      NOT NULL,
  relayer       text        NOT NULL,
  nonce         bigint      NOT NULL,
  execution_id  uuid        REFERENCES corral_executions(id) ON DELETE SET NULL,
  session_id    uuid        REFERENCES corral_sessions(id) ON DELETE SET NULL,
  status        text        NOT NULL DEFAULT 'ALLOCATED'
                            CHECK (status IN ('ALLOCATED', 'SENT', 'MINED', 'FAILED', 'ABANDONED')),
  tx_hash       text,
  -- Replacement attempts against the SAME nonce. Each must raise both fees by
  -- at least 10% or the node rejects it as an underpriced replacement.
  attempt       int         NOT NULL DEFAULT 0,
  max_fee       numeric(78,0),
  max_priority  numeric(78,0),
  allocated_at  timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  settled_at    timestamptz,
  last_error    text
);

-- The core guarantee: one live claim per (chain, relayer, nonce). Two workers
-- cannot hold the same nonce, and a replacement updates the row in place
-- rather than inserting a competing one.
CREATE UNIQUE INDEX IF NOT EXISTS corral_relayer_txs_live_nonce_idx
  ON corral_relayer_txs (chain_id, relayer, nonce)
  WHERE status IN ('ALLOCATED', 'SENT');

-- Drives the stuck-transaction sweep.
CREATE INDEX IF NOT EXISTS corral_relayer_txs_inflight_idx
  ON corral_relayer_txs (chain_id, relayer, status, sent_at);

CREATE INDEX IF NOT EXISTS corral_relayer_txs_execution_idx
  ON corral_relayer_txs (execution_id);
