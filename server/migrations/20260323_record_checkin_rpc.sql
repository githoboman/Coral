-- Create record_checkin RPC function for atomic check-in processing
CREATE OR REPLACE FUNCTION record_checkin(
  p_user_id        TEXT,
  p_checkin_date   TEXT,
  p_timezone_offset INTEGER,
  p_streak_day     INTEGER,
  p_points_earned  INTEGER,
  p_new_balance    NUMERIC
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Insert into checkins history
  INSERT INTO checkins (user_id, checkin_date, timezone_offset, streak_day, points_earned)
  VALUES (p_user_id, p_checkin_date, p_timezone_offset, p_streak_day, p_points_earned);

  -- Update user_profiles cache
  UPDATE user_profiles
  SET
    checkin_streak  = p_streak_day,
    total_checkins  = total_checkins + 1,
    points          = p_new_balance,
    checkin_points  = checkin_points + p_points_earned,
    last_checkin    = NOW()
  WHERE wallet_address = p_user_id;
END;
$$;
