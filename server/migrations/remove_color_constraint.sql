-- Migration: Remove color constraint from events table
-- This allows any color value to be used for events/alerts
-- Run this in Supabase SQL Editor

-- Drop the existing color check constraint
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_color_check;

-- Optional: If you want to add a more flexible constraint that just ensures color is not empty
-- ALTER TABLE events ADD CONSTRAINT events_color_not_empty CHECK (color IS NOT NULL AND color != '');

-- Verify the constraint was removed
SELECT conname, contype, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'events'::regclass 
AND conname LIKE '%color%';
