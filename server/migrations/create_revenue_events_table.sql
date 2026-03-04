
create table if not exists revenue_events (
  id uuid default gen_random_uuid() primary key,
  tx_digest text not null unique,
  sender text not null,
  amount bigint not null, -- stored in MIST
  event_type text not null, -- 'subscription', 'agent_fee'
  timestamp timestamptz default now()
);

-- Index for faster range queries
create index if not exists idx_revenue_timestamp on revenue_events(timestamp);
