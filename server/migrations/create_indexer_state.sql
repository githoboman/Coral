-- Table to store indexer state (cursors) to replace JSON files
CREATE TABLE IF NOT EXISTS indexer_state (
    id TEXT PRIMARY KEY, -- e.g., 'leaderboard_points', 'leaderboard_tasks', 'leaderboard_checkins'
    last_cursor TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Pre-populate with current keys if they don't exist
INSERT INTO indexer_state (id) VALUES ('points'), ('tasks'), ('checkins')
ON CONFLICT (id) DO NOTHING;
