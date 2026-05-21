-- Add referral_code and referred_by to user_profiles table
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS referral_code VARCHAR(12) UNIQUE,
ADD COLUMN IF NOT EXISTS referred_by VARCHAR(66);

-- The 'referrals' table already exists from a legacy attempt.
-- Existing columns: id (int8), referrer_id (text), referred_id (text), referral_code (text), points_awarded (int8), created_at (timestamptz)

-- Rename referred_id to referred_user_id to match our backend code
ALTER TABLE referrals RENAME COLUMN referred_id TO referred_user_id;

-- Add the missing columns
ALTER TABLE referrals
ALTER COLUMN referral_code DROP NOT NULL,
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'completed',
ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45),
ADD COLUMN IF NOT EXISTS device_fingerprint VARCHAR(255),
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;

-- Add constraints
ALTER TABLE referrals DROP CONSTRAINT IF EXISTS check_referral_status;
ALTER TABLE referrals
ADD CONSTRAINT check_referral_status CHECK (status IN ('pending', 'claimable', 'completed', 'abandoned'));

-- Create indices for quick lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_referral_code ON user_profiles(referral_code);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_id ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred_user_id ON referrals(referred_user_id);
