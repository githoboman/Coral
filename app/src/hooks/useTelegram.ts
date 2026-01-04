import { useEffect, useState, useCallback } from 'react';
import type { TelegramWebApp, WebAppUser, ThemeParams } from '@/types/telegram';
import {
  getTelegramWebApp,
  isTelegramEnvironment,
  getTelegramUser,
  getTelegramTheme,
  getTelegramColorScheme,
  triggerHaptic,
} from '@/utils/telegramUtils';

interface UseTelegramReturn {
  webApp: TelegramWebApp | null;
  user: WebAppUser | null;
  theme: ThemeParams | null;
  colorScheme: 'light' | 'dark' | null;
  isInTelegram: boolean;
  platform: string;
  viewportHeight: number;
  isExpanded: boolean;
  haptic: {
    impact: (style?: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notification: (type?: 'error' | 'success' | 'warning') => void;
    selection: () => void;
  };
}

/**
 * Custom hook for accessing Telegram Web App SDK features
 */
export const useTelegram = (): UseTelegramReturn => {
  const [webApp, setWebApp] = useState<TelegramWebApp | null>(null);
  const [user, setUser] = useState<WebAppUser | null>(null);
  const [theme, setTheme] = useState<ThemeParams | null>(null);
  const [colorScheme, setColorScheme] = useState<'light' | 'dark' | null>(null);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const tgWebApp = getTelegramWebApp();
    if (tgWebApp) {
      setWebApp(tgWebApp);
      setUser(getTelegramUser());
      setTheme(getTelegramTheme());
      setColorScheme(getTelegramColorScheme());
      setViewportHeight(tgWebApp.viewportHeight);
      setIsExpanded(tgWebApp.isExpanded);

      // Listen for viewport changes
      const handleViewportChanged = () => {
        setViewportHeight(tgWebApp.viewportHeight);
        setIsExpanded(tgWebApp.isExpanded);
      };

      tgWebApp.onEvent('viewportChanged', handleViewportChanged);

      // Listen for theme changes
      const handleThemeChanged = () => {
        setTheme(getTelegramTheme());
        setColorScheme(getTelegramColorScheme());
      };

      tgWebApp.onEvent('themeChanged', handleThemeChanged);

      return () => {
        tgWebApp.offEvent('viewportChanged', handleViewportChanged);
        tgWebApp.offEvent('themeChanged', handleThemeChanged);
      };
    }
  }, []);

  const haptic = {
    impact: useCallback((style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' = 'medium') => {
      triggerHaptic('impact', style);
    }, []),
    notification: useCallback((type: 'error' | 'success' | 'warning' = 'success') => {
      triggerHaptic('notification', type);
    }, []),
    selection: useCallback(() => {
      triggerHaptic('selection');
    }, []),
  };

  return {
    webApp,
    user,
    theme,
    colorScheme,
    isInTelegram: isTelegramEnvironment(),
    platform: webApp?.platform || 'unknown',
    viewportHeight,
    isExpanded,
    haptic,
  };
};

/**
 * Hook for managing Telegram Main Button
 */
export const useMainButton = (
  text: string,
  onClick: () => void,
  options?: {
    color?: string;
    textColor?: string;
    isActive?: boolean;
    isVisible?: boolean;
  }
) => {
  const { webApp } = useTelegram();

  useEffect(() => {
    if (!webApp?.MainButton) return;

    const mainButton = webApp.MainButton;

    // Set button properties
    mainButton.setParams({
      text,
      color: options?.color,
      text_color: options?.textColor,
      is_active: options?.isActive !== false,
      is_visible: options?.isVisible !== false,
    });

    // Add click handler
    mainButton.onClick(onClick);

    // Show button
    if (options?.isVisible !== false) {
      mainButton.show();
    }

    return () => {
      mainButton.offClick(onClick);
      mainButton.hide();
    };
  }, [webApp, text, onClick, options]);

  return {
    show: () => webApp?.MainButton.show(),
    hide: () => webApp?.MainButton.hide(),
    enable: () => webApp?.MainButton.enable(),
    disable: () => webApp?.MainButton.disable(),
    showProgress: () => webApp?.MainButton.showProgress(),
    hideProgress: () => webApp?.MainButton.hideProgress(),
    setText: (newText: string) => webApp?.MainButton.setText(newText),
  };
};

/**
 * Hook for managing Telegram Back Button
 */
export const useBackButton = (onClick: () => void, isVisible = true) => {
  const { webApp } = useTelegram();

  useEffect(() => {
    if (!webApp?.BackButton) return;

    const backButton = webApp.BackButton;

    // Add click handler
    backButton.onClick(onClick);

    // Show/hide button
    if (isVisible) {
      backButton.show();
    } else {
      backButton.hide();
    }

    return () => {
      backButton.offClick(onClick);
      backButton.hide();
    };
  }, [webApp, onClick, isVisible]);

  return {
    show: () => webApp?.BackButton.show(),
    hide: () => webApp?.BackButton.hide(),
  };
};

/**
 * Hook for Telegram Cloud Storage
 */
export const useCloudStorage = () => {
  const { webApp } = useTelegram();

  const setItem = useCallback(
    (key: string, value: string): Promise<boolean> => {
      return new Promise((resolve, reject) => {
        if (!webApp?.CloudStorage) {
          reject(new Error('Cloud Storage not available'));
          return;
        }

        webApp.CloudStorage.setItem(key, value, (error, success) => {
          if (error) reject(new Error(error));
          else resolve(success);
        });
      });
    },
    [webApp]
  );

  const getItem = useCallback(
    (key: string): Promise<string | null> => {
      return new Promise((resolve, reject) => {
        if (!webApp?.CloudStorage) {
          reject(new Error('Cloud Storage not available'));
          return;
        }

        webApp.CloudStorage.getItem(key, (error, value) => {
          if (error) reject(new Error(error));
          else resolve(value);
        });
      });
    },
    [webApp]
  );

  const removeItem = useCallback(
    (key: string): Promise<boolean> => {
      return new Promise((resolve, reject) => {
        if (!webApp?.CloudStorage) {
          reject(new Error('Cloud Storage not available'));
          return;
        }

        webApp.CloudStorage.removeItem(key, (error, success) => {
          if (error) reject(new Error(error));
          else resolve(success);
        });
      });
    },
    [webApp]
  );

  const getKeys = useCallback((): Promise<string[]> => {
    return new Promise((resolve, reject) => {
      if (!webApp?.CloudStorage) {
        reject(new Error('Cloud Storage not available'));
        return;
      }

      webApp.CloudStorage.getKeys((error, keys) => {
        if (error) reject(new Error(error));
        else resolve(keys);
      });
    });
  }, [webApp]);

  return {
    setItem,
    getItem,
    removeItem,
    getKeys,
  };
};
