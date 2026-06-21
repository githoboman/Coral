import { useCallback, useEffect, useState } from "react";

/**
 * App theme manager. Toggles a `.dark` class on <html> (the class-based variant
 * defined in global.css) and persists the choice to localStorage. Defaults to
 * dark — the app's native look — when nothing is stored.
 */

export type Theme = "light" | "dark";

const STORAGE_KEY = "coral_theme";

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" ? "light" : "dark";
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
}

/** Apply the persisted (or default) theme as early as possible. */
export function initTheme(): void {
  applyTheme(getStoredTheme());
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);

  useEffect(() => {
    applyTheme(theme);
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggleTheme = useCallback(
    () => setThemeState((t) => (t === "dark" ? "light" : "dark")),
    [],
  );

  return { theme, setTheme, toggleTheme };
}
