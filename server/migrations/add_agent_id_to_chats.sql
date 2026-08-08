-- Add agent_id column to chats table
ALTER TABLE chats ADD COLUMN agent_id TEXT NOT NULL DEFAULT 'main';
