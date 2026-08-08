-- Optional: Create chat_points table for tracking daily chat point limits
-- This table tracks daily chat points to enforce the 5 pts/day limit

CREATE TABLE IF NOT EXISTS chat_points (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  points_earned INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster daily queries
CREATE INDEX IF NOT EXISTS idx_chat_points_user_date ON chat_points(user_id, created_at);
