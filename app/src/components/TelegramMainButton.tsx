import React, { useEffect } from 'react';
import { useMainButton } from '@/hooks/useTelegram';

interface TelegramMainButtonProps {
  text: string;
  onClick: () => void;
  color?: string;
  textColor?: string;
  disabled?: boolean;
  loading?: boolean;
  visible?: boolean;
}

/**
 * Component wrapper for Telegram's native Main Button
 * The button appears at the bottom of the Telegram app
 */
export const TelegramMainButton: React.FC<TelegramMainButtonProps> = ({
  text,
  onClick,
  color,
  textColor,
  disabled = false,
  loading = false,
  visible = true,
}) => {
  const mainButton = useMainButton(text, onClick, {
    color,
    textColor,
    isActive: !disabled,
    isVisible: visible,
  });

  useEffect(() => {
    if (loading) {
      mainButton.showProgress?.();
    } else {
      mainButton.hideProgress?.();
    }
  }, [loading, mainButton]);

  useEffect(() => {
    if (disabled) {
      mainButton.disable?.();
    } else {
      mainButton.enable?.();
    }
  }, [disabled, mainButton]);

  useEffect(() => {
    if (visible) {
      mainButton.show?.();
    } else {
      mainButton.hide?.();
    }
  }, [visible, mainButton]);

  // This component doesn't render anything visible
  // It only controls the native Telegram Main Button
  return null;
};
