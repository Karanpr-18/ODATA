"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

export type Theme =
  | "crimson-sidebar-light"
  | "clean-crimson-light"
  | "soft-crimson-glass"
  | "midnight-crimson";

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "midnight-crimson",
  setTheme: () => {},
  toggleTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("midnight-crimson");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && window.localStorage) {
      const saved = window.localStorage.getItem("nexus-theme") as Theme | null;
      if (
        saved &&
        [
          "crimson-sidebar-light",
          "clean-crimson-light",
          "soft-crimson-glass",
          "midnight-crimson",
        ].includes(saved)
      ) {
        setTheme(saved);
      } else {
        setTheme("midnight-crimson");
      }
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && typeof window !== "undefined") {
      document.documentElement.setAttribute("data-theme", theme);
      if (window.localStorage) {
        window.localStorage.setItem("nexus-theme", theme);
      }
    }
  }, [theme, mounted]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const themes: Theme[] = [
        "crimson-sidebar-light",
        "clean-crimson-light",
        "soft-crimson-glass",
        "midnight-crimson",
      ];
      const nextIndex = (themes.indexOf(prev) + 1) % themes.length;
      return themes[nextIndex];
    });
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
