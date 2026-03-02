import { create } from "zustand";

export type ThemeName = "dark" | "light" | "fun" | "navy";

interface ThemeColors {
  backgroundPrimary: string;
  backgroundSecondary: string;
  backgroundTertiary: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accentPrimary: string;
  accentHover: string;
  channelDefault: string;
  channelHover: string;
  fontFamily: string;
}

// Colors stored as hex for readability; converted to RGB on apply
export const themes: Record<ThemeName, ThemeColors> = {
  dark: {
    backgroundPrimary: "#1a1a1a",
    backgroundSecondary: "#111111",
    backgroundTertiary: "#0a0a0a",
    textPrimary: "#f0f0f0",
    textSecondary: "#b0b0b0",
    textMuted: "#777777",
    accentPrimary: "#4caf50",
    accentHover: "#388e3c",
    channelDefault: "#888888",
    channelHover: "#d0d0d0",
    fontFamily: "'Roboto', 'Segoe UI', sans-serif",
  },
  light: {
    backgroundPrimary: "#e8e8e8",
    backgroundSecondary: "#d4d4d4",
    backgroundTertiary: "#c0c0c0",
    textPrimary: "#2a2a2a",
    textSecondary: "#4a4a4a",
    textMuted: "#6a6a6a",
    accentPrimary: "#4caf50",
    accentHover: "#388e3c",
    channelDefault: "#555555",
    channelHover: "#333333",
    fontFamily: "'Arial', 'Helvetica', sans-serif",
  },
  fun: {
    backgroundPrimary: "#fff8f0",
    backgroundSecondary: "#fff0e0",
    backgroundTertiary: "#ffe8d0",
    textPrimary: "#1a1a1a",
    textSecondary: "#444444",
    textMuted: "#888888",
    accentPrimary: "#ff6b6b",
    accentHover: "#ee5a5a",
    channelDefault: "#666666",
    channelHover: "#333333",
    fontFamily: "'Comic Sans MS', 'Segoe UI', cursive, sans-serif",
  },
  navy: {
    backgroundPrimary: "#1b2838",
    backgroundSecondary: "#152030",
    backgroundTertiary: "#101828",
    textPrimary: "#e0e8f0",
    textSecondary: "#8899aa",
    textMuted: "#607080",
    accentPrimary: "#5b9bd5",
    accentHover: "#4488cc",
    channelDefault: "#708090",
    channelHover: "#b0c0d0",
    fontFamily: "'Segoe UI', 'Roboto', sans-serif",
  },
};

const THEME_STORAGE_KEY = "vibe-chat-theme";

function loadSavedTheme(): ThemeName {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved && saved in themes) return saved as ThemeName;
  } catch {
    // Ignore
  }
  return "dark";
}

interface ThemeState {
  theme: ThemeName;
  setTheme: (theme: ThemeName) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: loadSavedTheme(),
  setTheme: (theme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore
    }
    set({ theme });
  },
}));

/**
 * Convert hex color to space-separated RGB values for Tailwind CSS variable opacity support.
 * e.g. "#1a1a1a" -> "26 26 26"
 */
function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r} ${g} ${b}`;
}

/**
 * Apply theme CSS variables to the document root.
 */
export function applyTheme(themeName: ThemeName): void {
  const t = themes[themeName];
  const root = document.documentElement;

  // Set as space-separated RGB values for Tailwind opacity support
  root.style.setProperty("--bg-primary", hexToRgb(t.backgroundPrimary));
  root.style.setProperty("--bg-secondary", hexToRgb(t.backgroundSecondary));
  root.style.setProperty("--bg-tertiary", hexToRgb(t.backgroundTertiary));
  root.style.setProperty("--text-primary", hexToRgb(t.textPrimary));
  root.style.setProperty("--text-secondary", hexToRgb(t.textSecondary));
  root.style.setProperty("--text-muted", hexToRgb(t.textMuted));
  root.style.setProperty("--accent-primary", hexToRgb(t.accentPrimary));
  root.style.setProperty("--accent-hover", hexToRgb(t.accentHover));
  root.style.setProperty("--channel-default", hexToRgb(t.channelDefault));
  root.style.setProperty("--channel-hover", hexToRgb(t.channelHover));

  document.body.style.fontFamily = t.fontFamily;
  document.body.style.backgroundColor = `rgb(${hexToRgb(t.backgroundPrimary)})`;
  document.body.style.color = `rgb(${hexToRgb(t.textPrimary)})`;

  // Handle fun theme confetti background
  if (themeName === "fun") {
    root.classList.add("theme-fun");
  } else {
    root.classList.remove("theme-fun");
  }
}
