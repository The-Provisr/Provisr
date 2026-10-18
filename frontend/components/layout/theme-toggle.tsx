"use client";

import { useEffect, useState } from "react";
import { MoonIcon, SunIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";

type Theme = "dark" | "light";

const STORAGE_KEY = "provisr-theme";

/**
 * FE-M03 theme toggle. Provisr ships dark-only (see `app/globals.css`); this
 * persists the user's preference and sets `data-theme` on <html> so a light
 * theme can be layered on later without changing this control. Until a light
 * palette lands it is a persisted, accessible preference — not a repaint.
 */
export function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      setTheme(stored);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const isDark = theme === "dark";

  return (
    <button
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={isDark}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-100",
        collapsed ? "size-9 justify-center" : "w-full px-3 py-2 text-xs font-medium",
      )}
      data-testid="theme-toggle"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
      type="button"
    >
      {isDark ? <MoonIcon className="size-4" /> : <SunIcon className="size-4" />}
      {collapsed ? null : <span>{isDark ? "Dark" : "Light"} theme</span>}
    </button>
  );
}
