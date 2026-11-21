import { useEffect, useState } from "react";
import { SettingsContext, loadSettings, saveSettings, useReducedMotion, type Settings } from "./lib/settings";
import { Page } from "./components/Page";
import { MemoryGame } from "./apps/MemoryGame";
import { TappingTracker } from "./apps/TappingTracker";
import { VoicePractice } from "./apps/VoicePractice";
import { Diary } from "./apps/Diary";
import { DiarySummary } from "./apps/DiarySummary";

const APPS = [
  {
    route: "memory",
    name: "Path Recall",
    blurb: "Watch a route light up across nine tiles, then tap it back. Add a beat to tap along for a dual-task challenge.",
  },
  {
    route: "tapping",
    name: "Tap Tracker",
    blurb: "Tap two targets in turn for 10 seconds with each hand. Track speed, rhythm and left/right differences over time.",
  },
  {
    route: "voice",
    name: "Voice Meter",
    blurb: "A live loudness meter with a target zone, plus timed 'ahh' and read-aloud exercises and a practice log.",
  },
  {
    route: "diary",
    name: "ON/OFF Diary",
    blurb: "Log how you feel through the day and print a one-page 7-day summary for your neurologist.",
  },
] as const;

const DISCLAIMER = "Practice and tracking tools, not medical treatment. Share results with your care team.";

function useHashRoute(): string {
  const read = () => window.location.hash.replace(/^#\/?/, "");
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onHash = () => setRoute(read());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

function Home() {
  return (
    <Page title="Practice & tracking">
      <p className="disclaimer" role="note">
        <strong>{DISCLAIMER}</strong>
      </p>
      <ul className="app-list">
        {APPS.map((a) => (
          <li key={a.route}>
            <a className="app-card" href={`#/${a.route}`}>
              <span className="app-name">{a.name}</span>
              <span className="app-blurb">{a.blurb}</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="muted">
        Everything you record stays in this browser on this device. Nothing is sent anywhere.
      </p>
    </Page>
  );
}

function SettingsPanel({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onChange({ ...settings, [key]: value });
  return (
    <div id="settings-panel" className="settings-panel" role="region" aria-label="Display settings">
      <label className="toggle-row">
        <input type="checkbox" checked={settings.largeText} onChange={(e) => set("largeText", e.target.checked)} />
        <span>Large text</span>
      </label>
      <label className="toggle-row">
        <input type="checkbox" checked={settings.motion === "reduce"} onChange={(e) => set("motion", e.target.checked ? "reduce" : "system")} />
        <span>Reduce motion</span>
      </label>
      <label className="toggle-row">
        <input type="checkbox" checked={settings.sound} onChange={(e) => set("sound", e.target.checked)} />
        <span>Sounds</span>
      </label>
      <fieldset className="choice-group">
        <legend>Theme</legend>
        {(["system", "light", "dark"] as const).map((t) => (
          <label key={t} className="choice">
            <input type="radio" name="theme" value={t} checked={settings.theme === t} onChange={() => set("theme", t)} />
            <span>{t === "system" ? "Match device" : t === "light" ? "Light" : "Dark"}</span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}

/** Applies the settings to <html> as data attributes; the CSS does the rest. */
function DocumentSettings({ settings }: { settings: Settings }) {
  const reduce = useReducedMotion();
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.largeText = String(settings.largeText);
    root.dataset.motion = reduce ? "reduce" : "full";
    if (settings.theme === "system") delete root.dataset.theme;
    else root.dataset.theme = settings.theme;
  }, [settings, reduce]);
  return null;
}

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const route = useHashRoute();

  const updateSettings = (s: Settings) => {
    setSettings(s);
    saveSettings(s);
  };

  let page;
  switch (route) {
    case "memory":
      page = <MemoryGame />;
      break;
    case "tapping":
      page = <TappingTracker />;
      break;
    case "voice":
      page = <VoicePractice />;
      break;
    case "diary":
      page = <Diary />;
      break;
    case "diary/summary":
      page = <DiarySummary />;
      break;
    default:
      page = <Home />;
  }

  return (
    <SettingsContext.Provider value={settings}>
      <DocumentSettings settings={settings} />
      <a className="skip-link no-print" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>
        Skip to content
      </a>
      <header className="top-bar no-print">
        {route ? (
          <a className="btn btn-secondary" href="#/">
            <span aria-hidden="true">←</span> Home
          </a>
        ) : (
          <span className="brand">Practice &amp; tracking</span>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          aria-expanded={showSettings}
          aria-controls="settings-panel"
          onClick={() => setShowSettings((v) => !v)}
        >
          Settings
        </button>
      </header>
      {showSettings && (
        <div className="no-print">
          <SettingsPanel settings={settings} onChange={updateSettings} />
        </div>
      )}
      <main id="main" tabIndex={-1}>
        {page}
      </main>
      <footer className="site-footer no-print">
        <p>{DISCLAIMER}</p>
      </footer>
    </SettingsContext.Provider>
  );
}
