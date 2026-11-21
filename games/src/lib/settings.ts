import { createContext, useContext, useEffect, useState } from "react";
import { load, save } from "./storage";

export interface Settings {
  largeText: boolean;
  theme: "system" | "light" | "dark";
  motion: "system" | "reduce";
  sound: boolean;
}

export const DEFAULT_SETTINGS: Settings = { largeText: false, theme: "system", motion: "system", sound: true };

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...load<Partial<Settings>>("settings", {}) };
}

export function saveSettings(s: Settings): void {
  save("settings", s);
}

export const SettingsContext = createContext<Settings>(DEFAULT_SETTINGS);

export function useSettings(): Settings {
  return useContext(SettingsContext);
}

function systemPrefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** True when motion should be reduced, by the user's setting or the OS setting. */
export function useReducedMotion(): boolean {
  const { motion } = useSettings();
  const [system, setSystem] = useState(systemPrefersReducedMotion);
  useEffect(() => {
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    } catch {
      return;
    }
    const onChange = () => setSystem(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return motion === "reduce" || system;
}
