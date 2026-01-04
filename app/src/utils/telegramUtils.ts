import type { TelegramWebApp } from '@/types/telegram';

/**
 * Get the Telegram Web App instance
 */
export const getTelegramWebApp = (): TelegramWebApp | null => {
  if (typeof window !== 'undefined' && window.Telegram?.WebApp) {
    return window.Telegram.WebApp;
  }
  return null;
};

/**
 * Check if the app is running inside Telegram
 */
export const isTelegramEnvironment = (): boolean => {
  return getTelegramWebApp() !== null;
};

/**
 * Initialize Telegram Web App
 */
export const initTelegramWebApp = (): void => {
  const webApp = getTelegramWebApp();
  if (webApp) {
    webApp.ready();
    webApp.expand();
  }
};

/**
 * Get Telegram user data
 */
export const getTelegramUser = () => {
  const webApp = getTelegramWebApp();
  return webApp?.initDataUnsafe?.user || null;
};

/**
 * Get Telegram theme parameters
 */
export const getTelegramTheme = () => {
  const webApp = getTelegramWebApp();
  return webApp?.themeParams || null;
};

/**
 * Get Telegram color scheme
 */
export const getTelegramColorScheme = (): 'light' | 'dark' | null => {
  const webApp = getTelegramWebApp();
  return webApp?.colorScheme || null;
};

/**
 * Validate Telegram init data hash
 * Note: This should be done on the backend for security
 */
export const getTelegramInitData = (): string => {
  const webApp = getTelegramWebApp();
  return webApp?.initData || '';
};

/**
 * Close the Telegram Mini App
 */
export const closeTelegramApp = (): void => {
  const webApp = getTelegramWebApp();
  webApp?.close();
};

/**
 * Open a link in Telegram
 */
export const openTelegramLink = (url: string): void => {
  const webApp = getTelegramWebApp();
  if (webApp) {
    webApp.openTelegramLink(url);
  } else {
    window.open(url, '_blank');
  }
};

/**
 * Open an external link
 */
export const openExternalLink = (url: string, tryInstantView = false): void => {
  const webApp = getTelegramWebApp();
  if (webApp) {
    webApp.openLink(url, { try_instant_view: tryInstantView });
  } else {
    window.open(url, '_blank');
  }
};

/**
 * Show a Telegram alert
 */
export const showTelegramAlert = (message: string, callback?: () => void): void => {
  const webApp = getTelegramWebApp();
  if (webApp) {
    webApp.showAlert(message, callback);
  } else {
    alert(message);
    callback?.();
  }
};

/**
 * Show a Telegram confirmation dialog
 */
export const showTelegramConfirm = (
  message: string,
  callback?: (confirmed: boolean) => void
): void => {
  const webApp = getTelegramWebApp();
  if (webApp) {
    webApp.showConfirm(message, callback);
  } else {
    const confirmed = confirm(message);
    callback?.(confirmed);
  }
};

/**
 * Trigger haptic feedback
 */
export const triggerHaptic = (
  type: 'impact' | 'notification' | 'selection',
  style?: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft' | 'error' | 'success' | 'warning'
): void => {
  const webApp = getTelegramWebApp();
  if (!webApp?.HapticFeedback) return;

  switch (type) {
    case 'impact':
      webApp.HapticFeedback.impactOccurred(
        (style as 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') || 'medium'
      );
      break;
    case 'notification':
      webApp.HapticFeedback.notificationOccurred(
        (style as 'error' | 'success' | 'warning') || 'success'
      );
      break;
    case 'selection':
      webApp.HapticFeedback.selectionChanged();
      break;
  }
};

/**
 * Apply Telegram theme colors to CSS variables
 */
export const applyTelegramTheme = (): void => {
  const theme = getTelegramTheme();
  if (!theme) return;

  const root = document.documentElement;

  if (theme.bg_color) root.style.setProperty('--tg-bg-color', theme.bg_color);
  if (theme.text_color) root.style.setProperty('--tg-text-color', theme.text_color);
  if (theme.hint_color) root.style.setProperty('--tg-hint-color', theme.hint_color);
  if (theme.link_color) root.style.setProperty('--tg-link-color', theme.link_color);
  if (theme.button_color) root.style.setProperty('--tg-button-color', theme.button_color);
  if (theme.button_text_color) root.style.setProperty('--tg-button-text-color', theme.button_text_color);
  if (theme.secondary_bg_color) root.style.setProperty('--tg-secondary-bg-color', theme.secondary_bg_color);
  if (theme.header_bg_color) root.style.setProperty('--tg-header-bg-color', theme.header_bg_color);
  if (theme.accent_text_color) root.style.setProperty('--tg-accent-text-color', theme.accent_text_color);
  if (theme.section_bg_color) root.style.setProperty('--tg-section-bg-color', theme.section_bg_color);
  if (theme.destructive_text_color) root.style.setProperty('--tg-destructive-text-color', theme.destructive_text_color);
};

/**
 * Get platform information
 */
export const getTelegramPlatform = (): string => {
  const webApp = getTelegramWebApp();
  return webApp?.platform || 'unknown';
};

/**
 * Check if user is on mobile
 */
export const isMobilePlatform = (): boolean => {
  const platform = getTelegramPlatform();
  return ['android', 'ios'].includes(platform.toLowerCase());
};
