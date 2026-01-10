-- Create checkins table for daily check-in feature
CREATE TABLE IF NOT EXISTS checkins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  points_earned INTEGER NOT NULL DEFAULT 1,
  streak_day INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster user queries
CREATE INDEX IF NOT EXISTS idx_checkins_user_id ON checkins(user_id);
CREATE INDEX IF NOT EXISTS idx_checkins_created_at ON checkins(created_at DESC);

-- Add columns to user_profiles table if they don't exist
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS checkin_streak INTEGER DEFAULT 0;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS last_checkin TIMESTAMP WITH TIME ZONE;
