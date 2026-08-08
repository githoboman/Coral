-- Migration to create/ensure user_profiles table
CREATE TABLE IF NOT EXISTS user_profiles (
    wallet_address TEXT PRIMARY KEY,
    username TEXT,
    email TEXT,
    points INTEGER DEFAULT 0,
    waitlist_points INTEGER DEFAULT 0,
    checkin_points INTEGER DEFAULT 0,
    task_points INTEGER DEFAULT 0,
    checkin_streak INTEGER DEFAULT 0,
    total_checkins INTEGER DEFAULT 0,
    last_checkin TIMESTAMP WITH TIME ZONE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_waitlisted BOOLEAN DEFAULT FALSE,
    preferences JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for wallet address (PK does this, but being explicit or for complex queries)
CREATE INDEX IF NOT EXISTS idx_user_profiles_points ON user_profiles(points DESC);
CREATE INDEX IF NOT EXISTS idx_user_profiles_streak ON user_profiles(checkin_streak DESC);
