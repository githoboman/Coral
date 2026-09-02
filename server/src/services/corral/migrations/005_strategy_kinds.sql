-- 005: fix the strategy-kind constraint
--
-- Migration 001 spelled the price-triggered strategy `PRICE_CONDITIONAL`.
-- The backlog ticket (C-604), FR-9.3, and the planner all call it
-- `CONDITIONAL_PRICE`. The constraint would therefore have rejected every row
-- of that kind — the strategy was unusable, and nothing would have said why
-- until someone tried to create one.
--
-- The old spelling stays accepted. Migrations are forward-only and must not
-- strand a row that already exists (spec §11.3), and dropping a value from a
-- CHECK constraint is exactly the kind of change that turns a rollback into an
-- outage. Nothing writes it any more.

ALTER TABLE corral_strategies DROP CONSTRAINT IF EXISTS corral_strategies_kind_check;

ALTER TABLE corral_strategies ADD CONSTRAINT corral_strategies_kind_check
  CHECK (kind IN (
    'DCA_FIXED',
    'DCA_PERCENT',
    'CONDITIONAL_PRICE',
    -- Deprecated spelling from migration 001. Accepted, never written.
    'PRICE_CONDITIONAL'
  ));
