# Тренировки Спина / Грудь / Ноги — workout tracker

A single-page Russian workout tracker: pick one of three training days, mark off
each completed set, edit weights and reps on the fly, and let a rest timer run
between sets. Everything lives in the browser — there is no backend, no
database, no account and no analytics.

Built with Next.js (App Router), Tailwind CSS v4 and [shadcn/ui](https://ui.shadcn.com)
components on Radix primitives.

---

## Behaviour

### The plans

Three workouts, six exercises each, rotated every other day:
**Спина → Грудь → Ноги → Спина → …** The back day totals 19 sets, the chest day
18 (17 if the butterfly is set to two) and the legs day 18.

The plans are a **static local snapshot** of the Obsidian note
«План тренировок.md», transcribed into `lib/workout-plan.ts`. There is no live
sync: the app never talks to Obsidian, holds no vault credentials and makes no
network requests at runtime. Changing the plan means editing that file.

#### Спина (спина, бицепс, задние дельты)

| # | Exercise | Sets × reps | Weight, kg | Hint |
|---|----------|-------------|------------|------|
| 1 | Тяга верхнего блока широким хватом | 4 × 8–12 | — | |
| 2 | Горизонтальная тяга | 3 × 10–12 | — | блок сидя, к животу |
| 3 | Тяга в наклоне | 3 × 10 | — | или нижний блок узким хватом |
| 4 | Разведение гантелей в наклоне | 3 × 12–15 | — | задняя дельта, лёгкий вес |
| 5 | Шраги со штангой/гантелями | 3 × 12 | — | |
| 6 | Бицепс стоя | 3 × 10 | 10 | слегка согнутые колени, руки прямые, чуть выведены вперёд; гантели |

#### Грудь (грудь, плечи, трицепс)

| # | Exercise | Sets × reps | Weight, kg | Hint |
|---|----------|-------------|------------|------|
| 1 | Жим лёжа | 3 × 8–10 | 10–13 | |
| 2 | Жим на наклонной | 3 × 10 | — | |
| 3 | Жим гантелей сидя | 3 × 10–12 | — | плечи |
| 4 | Разведение гантелей в стороны стоя | 3 × 12–15 | — | боковая дельта |
| 5 | Бабочка | **2–3** × 10–12 | 42–45 | по плану 2–3 подхода |
| 6 | Трицепс на «бычьих яйцах» | 3 × до отказа | 20 | начинать с 20 кг, понижать по 5 кг |

#### Ноги (ноги и пресс)

| # | Exercise | Sets × reps | Weight | Hint |
|---|----------|-------------|--------|------|
| 1 | Жим ногами | 3 × 10–12 | — | или Смит-приседания |
| 2 | Сгибание ног лежа на животе | 3 × 12 | — | бицепс бедра |
| 3 | Разгибание голени | 3 × 12 | — | квадрицепс |
| 4 | Подъём на икры стоя | 3 × 15 | — | |
| 5 | Пресс на наклонной скамье | 3 × 10–15 | свой вес | вниз головой |
| 6 | Планка или скручивания на блоке | 3 × до отказа | — | |

Weight and reps are free-form text, so ranges (`8–12`), single numbers, empty
values and words (`до отказа`, `свой вес`) are all valid. Where the source
prescribes no weight the field stays empty rather than inventing one. Technique,
alternatives and drop-set instructions live in the ⓘ panel (see below) rather
than on the cards.

### Choosing a workout — switching resets everything

The selector sits at the top as a three-choice radio group (`Спина`, `Грудь`,
`Ноги`) and the heading below it names the day. The muscle groups and the
rotation note moved into the ⓘ panel.

Internally the workouts keep their original ids (`pull`, `push`, `legs`), so a
saved session survives the renaming.

There is only **one session at a time**. Picking another workout therefore
**discards the current one**, which is why it is confirmed first:

> При смене тренировки текущий прогресс, изменённые веса и повторения, таймер и
> настройки будут сброшены. Продолжить?

* `Отмена`, Escape or the overlay keep everything, including the current
  selection and a running timer.
* `Продолжить` switches atomically: marks, edited weights and reps, the chosen
  set count, the rest preset, the sound preference and the timer all go back to
  the chosen workout's defaults. A running rest stops; nothing auto-starts and
  no finished rest beeps again.
* Switching back later is a **fresh** workout — nothing is kept per workout.
* Picking the workout that is already selected does nothing and asks nothing.

### Variable set count

The butterfly is prescribed as `2–3 × 10–12`. It defaults to **3** and carries a
small 2/3 radio group, labelled `Подходов`. The chosen count is what the card,
the total, the progress bar, the completion notice and the copied summary all
use (the chest day is 18 sets at three, 17 at two).

Lowering the count does not delete the third mark: it is parked, the ⓘ panel
says so (`Бабочка: отмечено подходов сверх выбранных — 1`), and raising the
count back to three counts it again.

### The ⓘ panel

Every explanation — muscle groups, rotation, how to mark sets, the timer,
persistence, reset and switching, the planned set ranges with any parked marks,
and the per-exercise technique hints — lives in a single modal opened by the
44 × 44 ⓘ button beside the heading (`Информация о тренировке`). It reflects the
selected workout, scrolls inside a `80dvh` cap, closes on `Закрыть`, Escape or
the overlay with focus returned to the button, and touches neither state,
storage nor the running timer. The page itself keeps only controls, numbers,
transient notices and the actionable storage warning.

### Progress

* Each `Подход N` button toggles a set. Done sets turn green with a check mark
  and expose `aria-pressed`.
* Every card shows `<sets> × <reps>` and its own completed count (`2/4`).
* The header shows `X / <total>`, a whole-number percentage and a green bar.
* When every set that counts is marked, a completion notice appears.

### Rest timer

Sits above the exercises and is **deadline-based**: a running timer stores the
absolute moment it ends, never a countdown counter. A throttled or backgrounded
tab therefore cannot drift, and returning to the tab snaps straight to the truth.

* Presets: 60 / 90 / 120 / 180 с. Default 90.
* Marking a set that was not yet done starts — or restarts — the rest.
  **Exception:** marking the final remaining set finishes the workout and leaves
  the timer idle instead.
* Unmarking a set never starts the timer.
* The timer never auto-starts on page load, nor when the workout changes.
* `Пауза` freezes the remainder; `Продолжить` resumes from exactly that
  remainder however long the pause lasted. Both are disabled while idle.
* `Пропустить` clears the timer (disabled while idle).
* Choosing a preset while idle just changes the duration; while running it
  restarts the countdown on the new preset; while paused it stays paused.

### Sound

A short two-tone beep, synthesised with the Web Audio API — no audio file is
fetched. On by default.

* It plays **only** when a rest ends naturally while the page is open. Restoring
  an already-expired timer after a reload never replays an overdue beep, and
  neither does switching workout.
* The `AudioContext` is unlocked from the click that can lead to a rest ending,
  since browsers only allow audio to start from a user gesture.
* On a browser without Web Audio the checkbox is disabled and says so; nothing
  throws.

### Copy and reset

* `Скопировать результаты` copies a plain-text summary of the **current**
  workout — its title, its exercises, the live marks, weights and reps and the
  **chosen** set counts — and reports either success or the real error. Free
  text is copied as written: no `кг` is appended to `свой вес`, no `повт.` to
  `до отказа`.
* `Начать заново` resets the **current** workout: marks cleared, the plan's
  weights, reps and set counts restored, timer idle at 90 с, sound back on. It
  does not change which workout is selected and asks no confirmation.

### Persistence

State is kept in `localStorage` under `ui-workout:state` — nothing else. No
`sessionStorage`, no IndexedDB, no cookies, no server.

The record holds **one** session: the selected workout id plus its completed
sets, edited weights and reps, chosen set counts, selected rest duration, sound
preference and timer (including a running timer's deadline or a paused timer's
frozen remainder). There is no per-workout history, because switching workout
throws the session away by design.

* **Versioned schema.** The record carries a `version` (currently `2`); anything
  from another version is ignored. Version 1 held the single hard-coded
  chest/shoulders plan with no workout id — such a record is simply dropped and
  the tracker starts fresh on the back day, rather than being migrated.
* **Validated on read.** Malformed JSON, wrong types, an unknown workout id, a
  set array whose length no longer matches the plan, a running timer with no
  deadline — any of these falls back to a fresh workout instead of crashing. The
  one lenient field is the chosen set count: an unusable value falls back to the
  plan default rather than discarding the saved progress with it.
* **Unavailable storage is survivable.** Blocked site data or a full quota is
  caught; the app keeps working and the footer says progress will not survive a
  reload.
* **Hydration-safe.** The page is statically prerendered, so the server and the
  first client render both produce the default back workout (`pull`). `useIsHydrated()`
  (a `useSyncExternalStore` with a differing server snapshot) re-keys the session
  the moment the client takes over, and that instance reads storage in its
  reducer initializer. No state is patched in from an effect, and the
  server-rendered pass never writes.
* **No default-state write.** Storage is only written once something is worth
  remembering; an untouched default workout clears the record rather than saving
  defaults. A non-default selection is itself worth remembering.
* **Timer restore.** A running timer comes back with the time that actually
  remains; one that expired while the page was closed comes back as
  `Отдых завершён` — silently. A paused timer keeps its exact remainder.

### Accessibility and layout

* The workout selector and the 2/3 set choice are Radix single toggle groups, so
  they are `radiogroup`s of `radio`s with roving arrow-key focus and
  `aria-checked`.
* The switch confirmation is a Radix alert dialog: `role="alertdialog"`, focus
  trapped and restored, labelled by its title and description, Escape closes it.
* Toggles expose `aria-pressed`; progress and timer status use `aria-live`;
  the clock is a `role="timer"`; copy results report through a live region.
* Everything is reachable and operable by keyboard with visible focus rings.
* Max content width 760 px, centred. Mobile-first with 16 px margins: no
  horizontal overflow at 360 px. Set buttons are 44 px tall and never shrink —
  three fit on one row, and the four of the first exercise of the back day wrap into two
  rows of two (four across from `sm` upwards).
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

[Vitest](https://vitest.dev) + Testing Library on jsdom, in five files:

| File | Covers |
|------|--------|
| `lib/workout-plan.test.ts` | the three plans against the source note: six exercises each, order, sets, reps, weights, hints, totals 19/18/18, unique ids |
| `lib/workout-state.test.ts` | the pure reducer: progress counting and rounding, set toggling, the variable set count and its parked marks, every timer transition, preset changes, throttled-tab recovery, the beep flag, switching workout, reset, results text |
| `lib/workout-storage.test.ts` | serialisation round-trip of the selected workout, every corrupt/incompatible-record case (including the superseded v1 schema), lenient set counts, restoring running / paused / expired / idle timers, unavailable storage, reset |
| `components/workout-tracker.test.tsx` | the wired UI: the selector and its confirm/cancel/Escape paths, switching resetting state and timer, variable sets, marking sets, the live countdown, pause/resume/skip, presets, sound, editing fields, persistence across a remount, corrupt-data fallback, reset, clipboard success and failure |
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
