import { useCallback, useEffect, useState } from "react";

export const THEMES = ["light", "dark", "cs16"] as const;
export type Theme = (typeof THEMES)[number];

const STORAGE_KEY = "fakalab.theme";

function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/**
 * Puts the theme on the document.
 *
 * This has to happen before anything reads the theme's custom properties, and
 * an effect is too late: React runs a child's effects before its parent's, so
 * the knife artwork, which paints itself by reading those properties, was
 * drawing with the previous theme's colours and stayed one change behind.
 */
function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

/** Stored choice first, then the viewer's system preference. */
function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    // Private windows and blocked site data both throw here.
  }

  try {
    if (window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
  } catch {
    // No matchMedia is fine; dark is the default anyway.
  }
  return "dark";
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(() => {
    const chosen = initialTheme();
    applyTheme(chosen);
    return chosen;
  });

  // A safety net for anything that changes the state without going through
  // setTheme; the real work is done before the render that needs it.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Remembering the choice is a convenience, not a requirement.
    }
  }, []);

  return [theme, setTheme];
}
