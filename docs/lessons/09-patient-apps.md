# Lesson 9: Apps and games for people with Parkinson's

**Goal:** build small, useful tools for daily life with Parkinson's, designed first for the hands, voice and eyes that will use them.
**Code:** `games/` (a standalone Vite + React + TypeScript app). The pure logic is in `games/src/lib/`, the screens are in `games/src/apps/`.

```bash
cd games
npm install
npm run dev          # open http://localhost:5173
npx vitest run       # unit tests, no browser needed
npm run build        # typecheck + production build
```

> **Practice and tracking tools, not medical treatment.** Nothing here diagnoses, treats or slows Parkinson's. The home screen says so, and the apps are worded to match: they help you *practise* and *record*, and point you back to your care team.

This lesson has no AI in it. It's the front-end lesson. Every design decision below comes from asking "what happens if the hand pressing this has a tremor, or the person using it is having an OFF period?"

## 1. What got built

| App | File | The idea |
|---|---|---|
| **Path Recall** | `apps/MemoryGame.tsx` | A route lights up across a 3×3 board of symbol tiles; you tap it back. Optional **dual-task mode** adds a beat to tap while you watch, because doing two things at once is often harder with Parkinson's. |
| **Tap Tracker** | `apps/TappingTracker.tsx` | Alternate-tap two big targets for 10 s per hand. Records speed, rhythm steadiness and left/right difference, with history and a trend chart. |
| **Voice Meter** | `apps/VoicePractice.tsx` | A live microphone meter with a target zone, "hold an ahh" and "read this sentence" exercises, and a practice log. |
| **ON/OFF Diary** | `apps/Diary.tsx`, `apps/DiarySummary.tsx` | Log your state through the day; see a 24-hour timeline; print a one-page 7-day summary for your neurologist; export and import JSON. |

The architecture is the same split as the Python side of this project: **pure logic in one place, UI in another.** `pubmed.py` has no AI in it and is tested on its own; `src/lib/*.ts` has no React or DOM in it and is tested on its own (24 tests in `src/lib/*.test.ts`). The React components just call those functions and draw the result.

No backend, no accounts, no UI framework, no chart library. Dependencies are React, React DOM, Vite, TypeScript and Vitest, all pinned to exact versions.

## 2. Tremor-friendly input design
Look at `components/TremorButton.tsx`. A normal `<button onClick>` is already better than many custom widgets, but it has three problems for a shaky hand:

1. **Act on release, not on landing.** A tremor often causes a wobbly *landing*. The button acts on `pointerup`, so you can land, settle, and lift. This is also how native buttons behave; the mistake is to "optimise" with `onPointerDown` or `onTouchStart`.
2. **Forgive a small slide.** On `pointerdown` we call `setPointerCapture()`, so the button keeps receiving events even if the finger drifts off its edge. On `pointerup` we check the finger is still within 24 px (`SLOP_PX`) of the button. A wobble still counts; deliberately sliding well away cancels, as on a phone.
3. **Ignore accidental double-taps.** A second press within `guardMs` (250 ms by default) is dropped. Without this, one tremor-y tap on "Save" can save twice.

Keyboard and screen readers still work: they fire a `click` event with `event.detail === 0`, which we handle; pointer-generated clicks (`detail >= 1`) are skipped because `pointerup` already acted.

Other choices in `styles.css`:
- `--tap: 64px`. Every button, form row and select is at least 64 px tall; game tiles and quick-log buttons are 88 px. (The usual guideline minimum is 44–48 px; that's for steady hands.)
- **Whole-row labels.** Checkboxes and radio buttons sit inside big `<label>` rows, so the whole row is the hit area, not the 16 px box. `:has(input:checked)` highlights the selected row.
- `touch-action: manipulation` removes the double-tap-to-zoom delay; `user-select: none` stops a long press from selecting text.
- **Space between targets.** The two tapping targets have a 1.5 rem gap, so a wobble doesn't hit the wrong one.
- **No drag-only interactions.** The voice target zone moves with "Lower" and "Raise" buttons, not a slider you have to drag.
- **One-tap logging.** The diary has four big "I'm ON now / I'm OFF now…" buttons. During an OFF period, a form with a date picker is the last thing you want. Each quick log shows an **Undo** button.

**When the rules change:** in the tapping test, *timing is the data*, so taps are recorded on `pointerdown` (the moment the finger lands) and there is no 250 ms guard, since fast tappers go below 200 ms per tap. Bounces are handled differently: taps must **alternate** between the two targets, and a second tap on the same target is not counted (`acceptTap()` in `lib/tapStats.ts`). Good accessibility rules have reasons; know the reason and you know when an exception is right.

## 3. Tap-variability statistics
`lib/tapStats.ts`, tested in `tapStats.test.ts`. Finger tapping is a familiar bedside check in Parkinson's because slowness (bradykinesia) and the rhythm breaking down both show up in it. We measure three things:

- **Taps per second** = accepted taps / 10 s.
- **Rhythm variability**: take the gaps between taps (inter-tap intervals), then the **coefficient of variation**:

  ```
  CV = standard deviation of intervals / mean interval × 100%
  ```

  A steady tapper at 200, 205, 195, 200 ms has a low CV; 150, 300, 180, 400 ms has a high one. CV is **scale-free**: a slow steady rhythm and a fast steady rhythm both score low, so it measures steadiness separately from speed. We use the *sample* standard deviation (divide by n − 1) because 40 taps is a sample, not the whole population.
- **Left/right asymmetry** = the difference as a percentage of the faster hand. Parkinson's often starts on one side, so the comparison is more informative than either number alone.

The app is careful not to over-interpret: results vary with sleep, time of day and medication timing, so it shows a **trend** and suggests sharing it, rather than judging one test.

## 4. A chart without a chart library
`components/TrendChart.tsx` is about 100 lines of SVG. The whole trick is two **scale functions** that map data to pixels:

```ts
const sx = (x: number) => PAD.left + ((x - xMin) / (xMax - xMin)) * plotW;   // time → px
const sy = (y: number) => PAD.top + plotH - (y / yMax) * plotH;               // value → px (SVG y grows downward)
```

Then each series is one `<path d="M x,y L x,y …">` plus a marker per point. Details that matter:
- The `viewBox` width follows the container (a `ResizeObserver`), so labels stay the same size on a phone and a desktop instead of scaling with the drawing.
- The two hands differ by **colour and marker shape** (circle vs square) and are named in a legend, so the chart doesn't rely on colour alone.
- The SVG has `role="img"` and a short `aria-label`; the full data is in a **table** right below it. A chart is a picture of a table; give screen-reader users the table.

## 5. Web Audio loudness: RMS → dB
`lib/loudness.ts` (pure maths) and `startMic()` in `apps/VoicePractice.tsx` (the browser plumbing).

```
getUserMedia ─▶ MediaStreamSource ─▶ AnalyserNode ─▶ getFloatTimeDomainData(buf) every 50 ms
                                                        │
                                       rms(buf) ─▶ 20·log10(rms) = dBFS ─▶ meter, zone, log
```

- The analyser gives a block of samples between −1 and 1. **RMS** (root mean square: square, average, square root) is the standard measure of how much energy is in the block.
- **Decibels** are logarithmic, which matches hearing: `dB = 20 × log10(rms)`. Full scale (rms 1) is 0 dBFS; rms 0.1 is −20 dBFS; silence is clamped to −100. A full-scale sine wave has RMS 1/√2 ≈ −3 dBFS; the tests check these numbers.
- **dBFS is not dB SPL.** It depends on the microphone, its gain and how far away your mouth is. So the app doesn't pretend to know "70 dB". Instead it **calibrates**: you speak normally for 4 s, it averages the voiced frames (ignoring pauses below a noise floor) and sets a target zone a few dB above that (`bandFromCalibration()`).
- We pass `autoGainControl: false` (and turn off noise suppression and echo cancellation). Otherwise the browser quietly evens out your volume, which is exactly what we're trying to measure.
- The analyser is **not connected to the speakers**, so there's no feedback howl.
- The `AudioContext` is created **inside the click handler**, before awaiting the permission prompt. Browsers only let audio start from a user gesture, and the gesture can expire while the prompt is open. This was a real bug found while testing: the meter sat at −100 dB because the context was suspended.

**Permission denial is a normal path, not an error.** `getUserMedia` throws a `DOMException` whose `name` tells you why: `NotAllowedError` (you said no, or the site is blocked), `NotFoundError` (no microphone), or no `mediaDevices` at all (not `https` or `localhost`). Each gets a plain-language message saying how to fix it, and the other three apps carry on working.

Accessibility for a live meter: it has `role="meter"` with `aria-valuenow` and a readable `aria-valuetext` ("−24 decibels. In the target zone"). A separate polite live region announces the zone at most every 2 seconds; announcing 20 times a second would make a screen reader unusable.

Wording note: the app talks about "voice practice" and a "target zone". It doesn't name or imitate any branded therapy programme, and it reminds you to rest if your voice feels strained and to follow your speech and language therapist.

## 6. The diary: from points to time
`lib/diary.ts`, tested in `diary.test.ts`. You log **moments** ("10:30, OFF"), but the summary needs **durations** ("4 h OFF"). `toSegments()` converts one into the other:

- Each entry's state lasts **until the next entry**, but for **at most 3 hours** (`MAX_SPAN_MS`). Without the cap, forgetting to log for an afternoon would silently count as hours of whatever you last logged.
- Segments are clipped to the day (or week) being summarised and to "now", so today's last entry doesn't stretch into the future.
- Percentages are of **recorded awake time** (ON + OFF + dyskinesia), with sleep shown separately, the way ON/OFF diaries are usually reported.
- Days are found with `startOfDay(t + 12 h)` rather than `t + 24 h`, so a daylight-saving change (a 23- or 25-hour day) doesn't skip or repeat a day. Date bugs are the most common bugs in tracking apps.

The 24-hour timeline (`components/DayTimeline.tsx`) is plain `<div>`s positioned with percentages, so it stretches to any width. Each state has a colour **and a pattern** (stripes for OFF, dots for dyskinesia, lines for asleep), made with CSS gradients.

## 7. localStorage, safely
`lib/storage.ts` is 30 lines and every app goes through it. `localStorage` **can throw**: in some private-browsing modes, when storage is disabled or full, or in a sandboxed iframe. So `load()` and `save()` wrap every call in `try/catch`, and a failure means "nothing saved", never a blank white screen. Other habits:
- Keys are prefixed (`pd-games:diary`) so the apps don't collide with anything else on the same origin.
- State is saved in a `useEffect` that watches it, not inside a `setState` updater. React may call updaters twice in development (`StrictMode`), so side effects inside them run twice. (This was a real bug in the first draft of the tapping tracker.)
- **Import is untrusted input.** `parseImport()` checks every field of every entry, drops entries that don't make sense, trims long strings, and reports how many it skipped, instead of trusting a file because it parsed as JSON. Same idea as validating tool inputs for the agent in Lesson 2.
- Data lives only in this browser, so the diary nudges you to **export a backup**. Clearing site data deletes it.

## 8. Print CSS: one page for the neurologist
`apps/DiarySummary.tsx` plus the `@media print` block at the end of `styles.css`. "Print or save as PDF" just calls `window.print()`; the CSS does the work:
- Hide everything that isn't the summary: `.no-print`, the header, the footer, buttons.
- **Force black on white** whatever theme is on screen by resetting the colour variables inside `@media print`, and set a fixed small font size (10 pt) so the large-text setting doesn't push it onto two pages.
- `break-inside: avoid` keeps each section from splitting across a page break; the medication list goes into two columns.
- Browsers skip background colours when printing by default, which would erase the timeline bars. `print-color-adjust: exact` on the timeline and swatches keeps them.
- The "Questions I want to ask" box is a `<textarea>` on screen and a `.print-only` paragraph on paper, because textareas print badly.
- Under the summary is a short **"How this is calculated"** note. A doctor reading "OFF 30%" needs to know what it is 30% *of*.

## 9. Themes, large text and reduced motion
All colours are CSS variables on `:root`. Dark values apply under `@media (prefers-color-scheme: dark)` *unless* the user picked light, and again under `[data-theme="dark"]` when they picked dark. `App.tsx` writes the settings onto `<html>` as data attributes (`data-theme`, `data-large-text`, `data-motion`) and CSS does the rest.
- **Large text** changes the root font size from 112.5% to 137.5%. Because every size is in `rem`, the whole layout scales with it.
- **Reduced motion** follows the OS setting or the in-app toggle; one rule turns off all transitions and animations. The game still *highlights* tiles (that's information) but drops the scale-up (that's decoration).
- **Focus** is a 4 px outline in a colour distinct from the buttons, and each new page moves focus to its heading (`components/Page.tsx`), so keyboard and screen-reader users start at the top.

## 10. Testing
`npx vitest run` runs 24 tests on the pure logic: tap statistics against hand-computed values, the staircase and beat matching with a seeded random generator (so tests are repeatable), dBFS against known values, and the diary summary across a week of fixed entries. The UI was checked by hand and with headless Chrome screenshots at 360 px wide, light and dark, large text, and in print mode. This is the same idea as `FakeModel` in Lesson 2: keep the hard-to-test parts thin, and put the logic where it's easy to test.

## Connecting to the research agent later (not built yet)
- **Diary → questions for my neurologist.** Export the 7-day summary as JSON and give it to the agent: "Here is my ON/OFF diary; what questions could I ask about wearing-off before doses?" The agent would answer with cited research and route every actionable point back to the neurologist, as its system prompt already requires.
- **Tapping and voice trends as context** for questions like "what does research say about tapping-speed changes over time?"
- **Personal knowledge base (Lesson 5):** diary exports could become private documents the agent can search, and they would stay in the git-ignored `data/` folder.
- **Evals (Lesson 7):** a safety eval that feeds the agent a diary and checks it never suggests changing medication.

## Try this
1. Turn on reduced motion in your OS settings and play Path Recall. What changes, and what stays the same?
2. In `TremorButton.tsx`, change `guardMs` to 0 and `SLOP_PX` to 0. Try to press buttons with a deliberately shaky hand on a phone. Then put them back.
3. Do the tapping test three times with each hand at different times of day. Does your CV change more than your speed?
4. Calibrate the voice meter, then read a sentence quietly and again with effort. How many dB apart are they? Move the phone twice as far away: the level should drop by about 6 dB (the inverse-square law).
5. Log a few diary entries, open the summary, and use "Save as PDF". Does it fit on one page? Switch to dark theme and large text and print again: does the printout change?
6. Export the diary, edit the JSON to add an entry with `"state": "flying"`, and import it. What does the app say?
7. Add a fifth diary state, "ON with non-troublesome dyskinesia", which many clinical diaries use. Which files do you have to touch? (Hint: start with `STATES` in `lib/diary.ts` and let TypeScript tell you the rest.)

## Interview questions you can now answer
- *How would you design touch input for users with tremor?* (Act on release, pointer capture with slop, debounce, large targets with spacing, no drag-only controls, and know when timing data needs `pointerdown` instead.)
- *How do you measure loudness from a microphone in the browser?* (`getUserMedia` → `AnalyserNode` → RMS → `20·log10` → dBFS; turn off auto-gain; calibrate, because dBFS isn't SPL.)
- *Why might an AudioContext stay silent, and how do you fix it?* (Autoplay policy: create or resume it within a user gesture.)
- *What is the coefficient of variation and why use it for rhythm?* (SD / mean; scale-free, so it separates steadiness from speed.)
- *How do you turn timestamped events into durations, and what goes wrong?* (Until the next event, with a cap; clip to the window; watch for daylight saving.)
- *How do you use localStorage safely?* (try/catch everything, namespace keys, validate imports, offer export, keep side effects out of state updaters.)
- *How do you make a web page print well?* (`@media print`, hide chrome, force colours, `break-inside`, `print-color-adjust`, fixed print font size.)
- *How do you make a chart accessible?* (Don't rely on colour alone, label series, `role="img"` with a summary, and a data table.)
- *How do you keep a health app from making medical claims?* (Wording reviewed against the rule "practise and record, don't treat or diagnose"; a visible disclaimer; point results to the care team.)

