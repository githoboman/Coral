-- Migration: Add task action fields for Web3 automation
-- Run this migration against your Supabase database

-- Add action-related columns to tasks table
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS action_type VARCHAR(50) DEFAULT 'reminder';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS action_params JSONB;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS action_status VARCHAR(50);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tx_digest VARCHAR(100);

-- Add index for querying actionable tasks
CREATE INDEX IF NOT EXISTS idx_tasks_action_status ON tasks(action_status) WHERE action_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_action_type ON tasks(action_type) WHERE action_type != 'reminder';

-- Add index for finding due tasks with actions
CREATE INDEX IF NOT EXISTS idx_tasks_due_actions ON tasks(due_date, action_status) 
WHERE action_type != 'reminder' AND action_status = 'pending';

-- Comment explaining the columns
COMMENT ON COLUMN tasks.action_type IS 'Type of automated action: reminder, token_transfer, dca_purchase';
COMMENT ON COLUMN tasks.action_params IS 'JSON parameters for the action (recipient, amount, etc.)';
COMMENT ON COLUMN tasks.action_status IS 'Execution status: pending, ready, awaiting_signature, executing, completed, failed';
COMMENT ON COLUMN tasks.tx_digest IS 'Sui transaction digest after successful execution';
