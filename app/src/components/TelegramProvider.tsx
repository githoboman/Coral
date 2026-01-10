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
    // Suppress Telegram Web App library logs
    const originalLog = console.log;
    const originalInfo = console.info;
    const originalWarn = console.warn;

    const filterLog = (originalMethod: any, args: any[]) => {
      if (args.some(arg => typeof arg === 'string' && arg.includes('[Telegram.WebView]'))) {
        return;
      }
      originalMethod.apply(console, args);
    };

    console.log = (...args) => filterLog(originalLog, args);
    console.info = (...args) => filterLog(originalInfo, args);
    // console.warn = (...args) => filterLog(originalWarn, args); // Optional: keep warnings

    return () => {
      console.log = originalLog;
      console.info = originalInfo;
      console.warn = originalWarn;
    };
  }, []);

  useEffect(() => {
    if (isInTelegram) {
      // Initialize Telegram Web App
      initTelegramWebApp();

      // Apply Telegram theme
      applyTelegramTheme();

      setIsInitialized(true);

      // Log initialization for debugging
      // console.log('[Telegram] Mini App initialized');
    } else {
      // console.log('[Telegram] Not running in Telegram environment');
      setIsInitialized(true);
    }
  }, [isInTelegram]);

  return (
    <TelegramContext.Provider value={{ isInitialized, isInTelegram }}>
      {children}
    </TelegramContext.Provider>
  );
};
