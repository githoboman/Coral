-- Create prices table for tracking coin prices
CREATE TABLE IF NOT EXISTS prices (
    id BIGSERIAL PRIMARY KEY,
    coin_type TEXT NOT NULL,
    price DECIMAL NOT NULL,
    change_24h DECIMAL NOT NULL DEFAULT 0,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_prices_coin_type ON prices(coin_type);
CREATE INDEX IF NOT EXISTS idx_prices_timestamp ON prices(timestamp DESC);

-- Allow public read access
ALTER TABLE prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read access for prices" ON prices FOR SELECT USING (true);
