-- 004: notifications (C-703, FR-10.x)
--
-- An OUTBOX, not a send. FR-10.5 says a delivery failure must never block or
-- delay an execution, and the only way to promise that is for the execution
-- path to write a row and stop. Delivery is a separate job that can fail, back
-- off, and retry without anything upstream noticing.

CREATE TABLE IF NOT EXISTS corral_notifications (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid        REFERENCES corral_sessions(id) ON DELETE CASCADE,
  execution_id    uuid        REFERENCES corral_executions(id) ON DELETE SET NULL,
  owner           text        NOT NULL,              -- wallet address the session belongs to
  trigger         text        NOT NULL,              -- EXECUTION_FAILED | BUDGET_THRESHOLD | …
  channel         text        NOT NULL CHECK (channel IN ('EMAIL', 'TELEGRAM')),
  subject         text        NOT NULL,
  body            text        NOT NULL,
  -- Deep link to the specific execution or session (FR-10.4).
  link            text,
  -- Whether the user has to do something, or is merely being told (FR-10.4).
  action_required boolean     NOT NULL DEFAULT false,
  -- Digest key (FR-10.3): one message per key per window, so a weekly DCA
  -- never produces more than one message per run no matter how many events
  -- the run generates.
  digest_key      text        NOT NULL,
  status          text        NOT NULL DEFAULT 'PENDING'
                              CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SUPPRESSED')),
  attempts        integer     NOT NULL DEFAULT 0,
  last_error      text,
  send_after      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- One pending message per digest key per channel. A second event that would
-- produce the same message collapses into the first rather than queueing
-- behind it.
CREATE UNIQUE INDEX IF NOT EXISTS corral_notifications_digest_idx
  ON corral_notifications (digest_key, channel)
  WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS corral_notifications_due_idx
  ON corral_notifications (send_after) WHERE status = 'PENDING';

CREATE INDEX IF NOT EXISTS corral_notifications_owner_idx
  ON corral_notifications (owner, created_at DESC);

-- Per-owner channel preferences. Absent row = email only, which is the
-- MUST channel in FR-10.1; Telegram is opt-in.
CREATE TABLE IF NOT EXISTS corral_notification_prefs (
  owner            text        PRIMARY KEY,
  email            text,
  telegram_chat_id text,
  email_enabled    boolean     NOT NULL DEFAULT true,
  telegram_enabled boolean     NOT NULL DEFAULT false,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Budget threshold notifications fire once per crossing, not once per read.
-- This records which thresholds have already been announced for a session.
CREATE TABLE IF NOT EXISTS corral_budget_notices (
  session_id   uuid        NOT NULL REFERENCES corral_sessions(id) ON DELETE CASCADE,
  asset        text        NOT NULL,
  threshold_pct integer    NOT NULL,
  notified_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, asset, threshold_pct)
);
