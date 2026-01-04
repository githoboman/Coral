import React, { createContext, useContext, useEffect, ReactNode } from 'react';
import { initTelegramWebApp, applyTelegramTheme, isTelegramEnvironment } from '@/utils/telegramUtils';

interface TelegramContextValue {
  isInitialized: boolean;
  isInTelegram: boolean;
}

const TelegramContext = createContext<TelegramContextValue>({
  isInitialized: false,
  isInTelegram: false,
});

export const useTelegramContext = () => useContext(TelegramContext);

interface TelegramProviderProps {
  children: ReactNode;
}

/**
 * Provider component for Telegram Web App SDK
 * Initializes the SDK and applies theme on mount
 */
export const TelegramProvider: React.FC<TelegramProviderProps> = ({ children }) => {
  const [isInitialized, setIsInitialized] = React.useState(false);
  const isInTelegram = isTelegramEnvironment();

  useEffect(() => {
    if (isInTelegram) {
      // Initialize Telegram Web App
      initTelegramWebApp();

      // Apply Telegram theme
      applyTelegramTheme();

      setIsInitialized(true);

      // Log initialization for debugging
      console.log('[Telegram] Mini App initialized');
      console.log('[Telegram] Platform:', window.Telegram?.WebApp.platform);
      console.log('[Telegram] Version:', window.Telegram?.WebApp.version);
      console.log('[Telegram] Color Scheme:', window.Telegram?.WebApp.colorScheme);
    } else {
      console.log('[Telegram] Not running in Telegram environment');
      setIsInitialized(true);
    }
  }, [isInTelegram]);

  return (
    <TelegramContext.Provider value={{ isInitialized, isInTelegram }}>
      {children}
    </TelegramContext.Provider>
  );
};
