# Practice & tracking apps

Four small web apps for people with Parkinson's, built for [Lesson 9](../docs/lessons/09-patient-apps.md).

> **Practice and tracking tools, not medical treatment.** They don't diagnose, treat or slow anything. Share results with your care team.

| App | What it does |
|---|---|
| **Path Recall** | A memory game: a route lights up across a 3×3 board of symbol tiles, then you tap it back. Adaptive length (2 up / 1 down). Optional dual-task mode adds a beat to tap along with while you watch. |
| **Tap Tracker** | Alternate-tap two large targets for 10 s per hand. Records taps per second, rhythm variability (coefficient of variation of inter-tap intervals) and the left/right difference, with history and a hand-drawn SVG trend chart. |
| **Voice Meter** | Live microphone loudness meter (Web Audio, RMS → dBFS) with an adjustable target zone, calibration from your normal voice, timed "ahh" and read-aloud exercises, and a practice log. |
| **ON/OFF Diary** | Log time, state (ON / OFF / ON with troublesome dyskinesia / asleep), medication and symptom notes. Day timeline, a printable one-page 7-day "summary for my neurologist", and JSON export/import. |

Everything is stored in the browser's `localStorage` on your device. There is no backend and nothing is sent anywhere.

## Run it

Needs Node 20 or newer.

```bash
cd games
npm install
npm run dev          # http://localhost:5173
```

The voice meter needs microphone permission, which browsers only grant on `https://` pages or `localhost`.

## Build, typecheck, test

```bash
npm run build        # typecheck + production build into dist/
npx tsc --noEmit     # typecheck only
npx vitest run       # unit tests for the pure logic (scoring, tap stats, loudness, diary summary)
npm run preview      # serve the built dist/ locally
```

`dist/` is a static site with relative paths, so it can be hosted anywhere (GitHub Pages, Cloudflare Pages, a folder on a server).

## Layout

```
src/
  lib/            pure logic, no React or DOM: easy to unit test
    tapStats.ts     taps/sec, inter-tap intervals, CV, left/right asymmetry
    memoryGame.ts   sequences, staircase difficulty, beat matching, scoring
    loudness.ts     RMS, dBFS, target zone, calibration, exercise summary
    diary.ts        entries → time segments → 7-day summary; import validation
    storage.ts      localStorage wrapped in try/catch
    settings.ts     large text, theme, reduced motion, sound
  components/
    TremorButton.tsx  acts on release, pointer capture with slop, double-tap guard
    TrendChart.tsx    hand-drawn SVG line chart
    DayTimeline.tsx   24-hour state bar (colour + pattern)
    Page.tsx          page wrapper that moves focus to the heading
  apps/           one file per app, plus DiarySummary.tsx (the print view)
  styles.css      CSS variables for themes, large text, reduced motion, print
```

## Accessibility checklist

- Every pressable thing is at least 64 px tall; game tiles and quick-log buttons are 88 px.
- Buttons act on release, tolerate a 24 px wobble off the edge, and ignore a second press within 250 ms.
- No drag-only interactions. Every app works with the keyboard (game tiles: keys 1–9; tapping test: F/J or ←/→).
- Light and dark themes (follows the device, or pick one), a large-text toggle, and reduced motion (follows the device, or force it).
- Live regions announce game steps and voice-zone changes; focus moves to each new page's heading and to results.
- States in the diary use colour and pattern, so they still read in black-and-white print.
