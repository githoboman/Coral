import React from 'react';
import { useBackButton } from '@/hooks/useTelegram';

interface TelegramBackButtonProps {
  onClick: () => void;
  visible?: boolean;
}

/**
 * Component wrapper for Telegram's native Back Button
 * The button appears in the header of the Telegram app
 */
export const TelegramBackButton: React.FC<TelegramBackButtonProps> = ({
  onClick,
  visible = true,
}) => {
  useBackButton(onClick, visible);

  // This component doesn't render anything visible
  // It only controls the native Telegram Back Button
  return null;
};
