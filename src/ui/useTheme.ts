import { useCallback, useEffect, useState } from "react";

export const THEMES = ["light", "dark", "cs16"] as const;
export type Theme = (typeof THEMES)[number];

const STORAGE_KEY = "fakalab.theme";

function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
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
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Remembering the choice is a convenience, not a requirement.
    }
  }, []);

  return [theme, setTheme];
}
