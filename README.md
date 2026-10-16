# Тренировка: грудь и плечи — workout tracker

A single-page Russian workout tracker: mark off each completed set, edit weights
and reps on the fly, and let a rest timer run between sets. Everything lives in
the browser — there is no backend, no database, no account and no analytics.

Built with Next.js (App Router), Tailwind CSS v4 and [shadcn/ui](https://ui.shadcn.com)
components on Radix primitives.

---

## Behaviour

### The workout

Five exercises, three sets each — fifteen sets in total.

| # | Exercise | Sets × reps | Weight, kg |
|---|----------|-------------|------------|
| 1 | Жим лёжа | 3 × 8–10 | 10–13 |
| 2 | Жим на наклонной | 3 × 10 | — |
| 3 | Жим гантелей сидя | 3 × 10–12 | — |
| 4 | Разведение гантелей в стороны стоя | 3 × 12–15 | — |
| 5 | Бабочка | 3 × 10–12 | 42–45 |

Weight and reps are free-form text, so ranges (`8–10`), single numbers and empty
values are all valid. Both fields carry accessible labels.

### Progress

* Each `Подход N` button toggles a set. Done sets turn green with a check mark
  and expose `aria-pressed`.
* Every card shows `3 × <reps>` and its own completed count (`2/3`).
* The header shows `X / 15`, a whole-number percentage and a green progress bar.
* At 15/15 a completion notice appears.

### Rest timer

Sits above the exercises and is **deadline-based**: a running timer stores the
absolute moment it ends, never a countdown counter. A throttled or backgrounded
tab therefore cannot drift, and returning to the tab snaps straight to the truth.

* Presets: 60 / 90 / 120 / 180 с. Default 90.
* Marking a set that was not yet done starts — or restarts — the rest.
  **Exception:** marking the final remaining set finishes the workout and leaves
  the timer idle instead.
* Unmarking a set never starts the timer.
* The timer never auto-starts on page load.
* `Пауза` freezes the remainder; `Продолжить` resumes from exactly that
  remainder however long the pause lasted. Both are disabled while idle.
* `Пропустить` clears the timer (disabled while idle).
* Choosing a preset while idle just changes the duration; while running it
  restarts the countdown on the new preset; while paused it stays paused.

### Sound

A short two-tone beep, synthesised with the Web Audio API — no audio file is
fetched. On by default.

* It plays **only** when a rest ends naturally while the page is open. Restoring
  an already-expired timer after a reload never replays an overdue beep.
* The `AudioContext` is unlocked from the click that can lead to a rest ending,
  since browsers only allow audio to start from a user gesture.
* On a browser without Web Audio the checkbox is disabled and says so; nothing
  throws.

### Copy and reset

* `Скопировать результаты` copies a plain-text summary built from the **current**
  marks, weights and reps, and reports either success or the real error.
* `Начать заново` clears marks, restores the plan's weights and reps, resets the
  timer to idle at 90 с, turns sound back on and deletes the saved record.

### Persistence

State is kept in `localStorage` under `ui-workout:state` — nothing else. No
`sessionStorage`, no IndexedDB, no cookies, no server.

Saved: completed sets, edited weights and reps, the selected rest duration, the
sound preference and the timer (including a running timer's deadline or a paused
timer's frozen remainder).

* **Versioned schema.** The record carries a `version`; anything from another
  version is ignored.
* **Validated on read.** Malformed JSON, wrong types, a set array whose length no
  longer matches the plan, a running timer with no deadline — any of these falls
  back to a fresh workout instead of crashing.
* **Unavailable storage is survivable.** Blocked site data or a full quota is
  caught; the app keeps working and the footer says progress will not survive a
  reload.
* **Hydration-safe.** The page is statically prerendered, so the server and the
  first client render both produce the default workout. `useIsHydrated()`
  (a `useSyncExternalStore` with a differing server snapshot) re-keys the session
  the moment the client takes over, and that instance reads storage in its
  reducer initializer. No state is patched in from an effect, and the
  server-rendered pass never writes.
* **No default-state write.** Storage is only written once something is worth
  remembering; an untouched workout clears the record rather than saving defaults.
* **Timer restore.** A running timer comes back with the time that actually
  remains; one that expired while the page was closed comes back as
  `Отдых завершён` — silently. A paused timer keeps its exact remainder.

### Accessibility and layout

* Toggles expose `aria-pressed`; progress and timer status use `aria-live`;
  the clock is a `role="timer"`; copy results report through a live region.
* Everything is reachable and operable by keyboard with visible focus rings.
* Max content width 760 px, centred. Mobile-first with 16 px margins; the three
  set buttons stay on one row down to 360 px. Desktop uses the same single column.
* Pure black background, system font stack only — no fonts are fetched over the
  network.

---

## Commands

```bash
npm install

npm run dev         # development server on http://localhost:3000
npm run build       # production build (standalone output)
npm start           # serve the production build

npm test            # run the test suite once
npm run test:watch  # watch mode
npm run lint        # ESLint
npm run typecheck   # tsc --noEmit
```

### Tests

[Vitest](https://vitest.dev) + Testing Library on jsdom, in four files:

| File | Covers |
|------|--------|
| `lib/workout-state.test.ts` | the pure reducer: progress counting and rounding, set toggling, every timer transition, preset changes, throttled-tab recovery, the beep flag, reset, results text |
| `lib/workout-storage.test.ts` | serialisation round-trip, every corrupt/incompatible-record case, restoring running / paused / expired / idle timers, unavailable storage, reset |
| `components/workout-tracker.test.tsx` | the wired UI: marking sets, the live countdown, pause/resume/skip, presets, sound, editing fields, persistence across a remount, corrupt-data fallback, reset, clipboard success and failure |
| `components/workout-tracker.hydration.test.tsx` | the real `renderToString` → `hydrateRoot` path: default markup on the server, no hydration mismatch, saved state adopted after hydration without being clobbered |

Timer behaviour is driven with Vitest fake timers; the state module takes `now`
as an argument, so most of it is tested as pure functions.

---

## Docker

Multi-stage build on `node:24-alpine`, producing Next.js standalone output and
running as the unprivileged `node` user.

```bash
docker build -t ui-workout:local .
docker compose up -d
```

`compose.yaml` defines a single service `ui-workout`:

* image `ui-workout:local`, container name `ui-workout`, `restart: unless-stopped`
* port 3000 is **exposed only**, never published to the host
* joins the external network `malakhovsu_web` with the alias `ui-workout`, which
  is how the shared reverse proxy reaches it
* health check: `wget -q -O /dev/null http://127.0.0.1:3000/`
* memory limited to 320 MB, reserving 96 MB

The external network and the reverse-proxy configuration are owned elsewhere and
are not part of this repository.
