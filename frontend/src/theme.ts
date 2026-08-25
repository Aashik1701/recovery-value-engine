/**
 * Shared light/dark theme state for the whole app (dashboard + landing).
 * One `data-theme` attribute on <html> drives both stylesheets, and one
 * localStorage key means a choice made on either page carries over when
 * navigating to the other.
 */
import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "rve-theme";

export function getSystemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getStoredTheme(): Theme | null {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : null;
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

/** Reads the current theme from the DOM (already set by the inline boot script in index.html) and exposes a setter that persists + applies it. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(
    () => (document.documentElement.getAttribute("data-theme") as Theme | null) ?? getSystemTheme(),
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Pick up a theme change made on the other route (landing <-> dashboard)
  // via storage events from other tabs, and via a same-tab custom event
  // since `storage` doesn't fire in the tab that made the change.
  useEffect(() => {
    const sync = () => {
      const stored = getStoredTheme();
      if (stored && stored !== theme) setThemeState(stored);
    };
    window.addEventListener("storage", sync);
    window.addEventListener("rve-theme-change", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("rve-theme-change", sync);
    };
  }, [theme]);

  const setTheme = (next: Theme) => {
    localStorage.setItem(THEME_STORAGE_KEY, next);
    setThemeState(next);
    window.dispatchEvent(new Event("rve-theme-change"));
  };

  return [theme, setTheme];
}
