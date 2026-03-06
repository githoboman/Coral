-- Create notification delivery log table for tracking notification delivery status
CREATE TABLE IF NOT EXISTS notification_delivery_log (
  id BIGSERIAL PRIMARY KEY,
  wallet_address VARCHAR(66) NOT NULL,
  notification_type VARCHAR(50) NOT NULL,
  external_id VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  delivered_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  error_message TEXT,
  retry_count INTEGER DEFAULT 0
);

-- Index for querying notifications by wallet and status
CREATE INDEX IF NOT EXISTS idx_notification_delivery_wallet_status 
  ON notification_delivery_log(wallet_address, status);

-- Index for querying by notification type
CREATE INDEX IF NOT EXISTS idx_notification_delivery_type 
  ON notification_delivery_log(notification_type);

-- Index for querying by created_at for cleanup
CREATE INDEX IF NOT EXISTS idx_notification_delivery_created 
  ON notification_delivery_log(created_at);
