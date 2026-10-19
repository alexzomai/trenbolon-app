/**
 * The rest-timer switch, the two rest durations and the overall workout clock.
 *
 * Kept apart from `workout-state.test.ts` (the model's long-standing rules) so
 * the behaviour added around the timer can be read in one place.
 */

import { describe, expect, it } from "vitest"

import { DEFAULT_EXERCISE_REST_SECONDS, getWorkout } from "./workout-plan"
import {
  createInitialState,
  elapsedMs,
  formatClock,
  isClockRunning,
  isWorkoutComplete,
  restSecondsFor,
  setsFor,
  workoutOf,
  workoutReducer,
  type WorkoutState,
} from "./workout-state"
import { SCHEMA_VERSION, parseState, serializeState } from "./workout-storage"

const T0 = 1_700_000_000_000
const PUSH = getWorkout("push")

function toggle(state: WorkoutState, exerciseId: string, setIndex: number, now = T0): WorkoutState {
  return workoutReducer(state, { type: "toggle-set", exerciseId, setIndex, now })
}

/** Mark every set of one exercise, oldest slot first. */
function finishExercise(state: WorkoutState, exerciseId: string, now = T0): WorkoutState {
  const exercise = workoutOf(state).exercises.find((item) => item.id === exerciseId)!
  let next = state
  for (let index = 0; index < setsFor(next, exercise); index += 1) {
    // Only slots that are still open, so this never unmarks what is already done.
    if (next.completed[exerciseId]?.[index]) continue
    next = toggle(next, exerciseId, index, now)
  }
  return next
}

/** Mark every set that counts, exercise by exercise. */
function markAll(state: WorkoutState, now = T0): WorkoutState {
  let next = state
  for (const exercise of workoutOf(state).exercises) {
    next = finishExercise(next, exercise.id, now)
  }
  return next
}

describe("the rest timer switch", () => {
  it("is enabled by default and independent of the sound preference", () => {
    const state = createInitialState("push")
    expect(state.timerEnabled).toBe(true)

    const muted = workoutReducer(state, { type: "set-sound", enabled: false })
    expect(muted.timerEnabled).toBe(true)

    const off = workoutReducer(state, { type: "set-timer-enabled", enabled: false })
    expect(off.soundEnabled).toBe(true)
  })

  it("cancels a running rest at once, keeping progress and the durations", () => {
    let state = createInitialState("push")
    state = workoutReducer(state, { type: "select-duration", seconds: 120, now: T0 })
    state = workoutReducer(state, { type: "select-duration", seconds: 240, now: T0, kind: "exercise" })
    state = toggle(state, "bench-press", 0)
    expect(state.timer.status).toBe("running")

    const off = workoutReducer(state, { type: "set-timer-enabled", enabled: false })

    expect(off.timer.status).toBe("idle")
    expect(off.timer.deadline).toBeNull()
    expect(off.beepAt).toBeNull()
    // Progress and both durations survive.
    expect(off.completed["bench-press"]).toEqual([true, false, false])
    expect(restSecondsFor(off, "set")).toBe(120)
    expect(restSecondsFor(off, "exercise")).toBe(240)
  })

  it("cancels a paused and a finished rest too", () => {
    let paused = toggle(createInitialState("push"), "bench-press", 0)
    paused = workoutReducer(paused, { type: "pause", now: T0 + 10_000 })
    expect(
      workoutReducer(paused, { type: "set-timer-enabled", enabled: false }).timer.status
    ).toBe("idle")

    let finished = toggle(createInitialState("push"), "bench-press", 0)
    finished = workoutReducer(finished, { type: "tick", now: T0 + 90_000 })
    expect(finished.timer.status).toBe("finished")
    const off = workoutReducer(finished, { type: "set-timer-enabled", enabled: false })
    expect(off.timer.status).toBe("idle")
  })

  it("never starts a rest, nor a beep, while switched off", () => {
    let state = workoutReducer(createInitialState("push"), {
      type: "set-timer-enabled",
      enabled: false,
    })

    state = toggle(state, "bench-press", 0)
    expect(state.timer.status).toBe("idle")
    expect(state.beepAt).toBeNull()
    // Completing an exercise does not start the between-exercise rest either.
    state = toggle(state, "bench-press", 1, T0 + 1_000)
    state = toggle(state, "bench-press", 2, T0 + 2_000)
    expect(state.timer.status).toBe("idle")
    expect(state.beepAt).toBeNull()
    // A tick cannot resurrect a countdown that never started.
    expect(workoutReducer(state, { type: "tick", now: T0 + 600_000 })).toBe(state)
    // The marks themselves are perfectly normal.
    expect(state.completed["bench-press"]).toEqual([true, true, true])
  })

  it("stays idle when switched back on, until the next new set", () => {
    let state = workoutReducer(createInitialState("push"), {
      type: "set-timer-enabled",
      enabled: false,
    })
    state = toggle(state, "bench-press", 0)
    state = workoutReducer(state, { type: "set-timer-enabled", enabled: true })

    expect(state.timerEnabled).toBe(true)
    expect(state.timer.status).toBe("idle")

    // Unmarking still starts nothing.
    state = toggle(state, "bench-press", 0, T0 + 1_000)
    expect(state.timer.status).toBe("idle")

    state = toggle(state, "bench-press", 1, T0 + 2_000)
    expect(state.timer.status).toBe("running")
    expect(state.timer.deadline).toBe(T0 + 2_000 + 90_000)
  })

  it("round-trips the flag through storage", () => {
    const off = workoutReducer(createInitialState("push"), {
      type: "set-timer-enabled",
      enabled: false,
    })
    expect(parseState(serializeState(off), T0)?.timerEnabled).toBe(false)
  })
})

describe("between-set durations", () => {
  it("offers 90 and 120 as presets and remembers which is selected", () => {
    let state = createInitialState("push")
    expect(state.rest.mode).toBe("preset")
    expect(restSecondsFor(state, "set")).toBe(90)

    state = workoutReducer(state, { type: "select-duration", seconds: 120, now: T0, mode: "preset" })
    expect(state.rest).toMatchObject({ mode: "preset", presetSeconds: 120 })
    expect(restSecondsFor(state, "set")).toBe(120)
    expect(parseState(serializeState(state), T0)?.rest).toMatchObject({
      mode: "preset",
      presetSeconds: 120,
    })
  })

  it("keeps a custom duration, and the custom selection, across a reload", () => {
    const state = workoutReducer(createInitialState("push"), {
      type: "select-duration",
      seconds: 75,
      now: T0,
      mode: "custom",
    })
    expect(state.rest).toMatchObject({ mode: "custom", customSeconds: 75 })

    const restored = parseState(serializeState(state), T0 + 5_000)!
    expect(restored.rest).toMatchObject({ mode: "custom", customSeconds: 75 })
    expect(restSecondsFor(restored, "set")).toBe(75)
  })

  it("keeps the custom selection even when the value is 90 or 120", () => {
    const state = workoutReducer(createInitialState("push"), {
      type: "select-duration",
      seconds: 90,
      now: T0,
      mode: "custom",
    })
    expect(state.rest.mode).toBe("custom")

    const restored = parseState(serializeState(state), T0)!
    expect(restored.rest).toMatchObject({ mode: "custom", customSeconds: 90 })
    // Switching back to a preset leaves the custom value remembered.
    const back = workoutReducer(restored, {
      type: "select-duration",
      seconds: 120,
      now: T0,
      mode: "preset",
    })
    expect(back.rest).toMatchObject({ mode: "preset", presetSeconds: 120, customSeconds: 90 })
  })

  it("refuses empty, zero, negative, fractional, NaN and oversized durations", () => {
    const state = workoutReducer(createInitialState("push"), {
      type: "select-duration",
      seconds: 75,
      now: T0,
      mode: "custom",
    })
    for (const seconds of [0, -1, -90, 0.5, 90.5, NaN, Infinity, 3601, 100_000]) {
      expect(workoutReducer(state, { type: "select-duration", seconds, now: T0 })).toBe(state)
      expect(
        workoutReducer(state, { type: "select-duration", seconds, now: T0, kind: "exercise" })
      ).toBe(state)
    }
    // Nothing was committed, so the stored draft is still the last valid one.
    expect(restSecondsFor(state, "set")).toBe(75)
    expect(restSecondsFor(state, "exercise")).toBe(DEFAULT_EXERCISE_REST_SECONDS)
    // The bounds themselves are accepted.
    for (const seconds of [1, 3600]) {
      expect(
        workoutReducer(state, { type: "select-duration", seconds, now: T0 }).rest.customSeconds
      ).toBe(seconds)
    }
  })

  it("applies a new duration to a running, paused or idle rest of its own kind", () => {
    const running = toggle(createInitialState("push"), "bench-press", 0)
    const restarted = workoutReducer(running, {
      type: "select-duration",
      seconds: 120,
      now: T0 + 30_000,
    })
    expect(restarted.timer).toMatchObject({
      status: "running",
      durationSeconds: 120,
      deadline: T0 + 30_000 + 120_000,
      kind: "set",
    })

    const paused = workoutReducer(running, { type: "pause", now: T0 + 10_000 })
    const repaused = workoutReducer(paused, {
      type: "select-duration",
      seconds: 45,
      now: T0 + 20_000,
    })
    expect(repaused.timer).toMatchObject({ status: "paused", remainingMs: 45_000, kind: "set" })

    const idle = workoutReducer(createInitialState("push"), {
      type: "select-duration",
      seconds: 120,
      now: T0,
    })
    expect(idle.timer).toMatchObject({ status: "idle", durationSeconds: 120, deadline: null })
  })

  it("leaves pause, resume, skip and the alarm stop untouched", () => {
    let state = toggle(createInitialState("push"), "bench-press", 0)
    state = workoutReducer(state, { type: "pause", now: T0 + 10_000 })
    expect(state.timer.remainingMs).toBe(80_000)
    state = workoutReducer(state, { type: "resume", now: T0 + 60_000 })
    expect(state.timer.deadline).toBe(T0 + 60_000 + 80_000)
    state = workoutReducer(state, { type: "skip" })
    expect(state.timer.status).toBe("idle")
  })
})

describe("the between-exercise rest", () => {
  it("defaults to 180 s and is separate from the between-set duration", () => {
    let state = createInitialState("push")
    expect(restSecondsFor(state, "exercise")).toBe(180)

    state = workoutReducer(state, { type: "select-duration", seconds: 120, now: T0 })
    expect(restSecondsFor(state, "exercise")).toBe(180)

    state = workoutReducer(state, {
      type: "select-duration",
      seconds: 240,
      now: T0,
      kind: "exercise",
    })
    expect(restSecondsFor(state, "exercise")).toBe(240)
    expect(restSecondsFor(state, "set")).toBe(120)
  })

  it("runs only when the exercise's last uncompleted set is marked", () => {
    let state = createInitialState("push")

    state = toggle(state, "bench-press", 0)
    expect(state.timer).toMatchObject({ kind: "set", durationSeconds: 90 })

    state = toggle(state, "bench-press", 1, T0 + 1_000)
    expect(state.timer).toMatchObject({ kind: "set", durationSeconds: 90 })

    state = toggle(state, "bench-press", 2, T0 + 2_000)
    expect(state.timer).toMatchObject({
      status: "running",
      kind: "exercise",
      durationSeconds: 180,
      deadline: T0 + 2_000 + 180_000,
    })

    // The next exercise's first set is an ordinary between-set rest again.
    state = toggle(state, "incline-press", 0, T0 + 3_000)
    expect(state.timer).toMatchObject({ kind: "set", durationSeconds: 90 })
  })

  it("follows out-of-order marks: what counts is that nothing is left", () => {
    let state = createInitialState("push")
    state = toggle(state, "bench-press", 2)
    expect(state.timer.kind).toBe("set")
    state = toggle(state, "bench-press", 0, T0 + 1_000)
    expect(state.timer.kind).toBe("set")
    state = toggle(state, "bench-press", 1, T0 + 2_000)
    expect(state.timer.kind).toBe("exercise")
  })

  it("honours a lowered set count: fewer sets complete the exercise sooner", () => {
    let state = createInitialState(createSavedChoice())
    state = workoutReducer(state, { type: "set-sets", exerciseId: "a", count: 2 })
    state = toggle(state, "a", 0)
    expect(state.timer.kind).toBe("set")
    state = toggle(state, "a", 1, T0 + 1_000)
    expect(state.timer.kind).toBe("exercise")
  })

  it("starts nothing at all on the final set of the workout", () => {
    let state = createInitialState("push")
    for (const exercise of PUSH.exercises) {
      for (let index = 0; index < exercise.sets; index += 1) {
        if (exercise.id === "pull-ups" && index === 2) continue
        state = toggle(state, exercise.id, index)
      }
    }
    // One set short of the workout, so an ordinary between-set rest is running.
    expect(state.timer).toMatchObject({ status: "running", kind: "set" })

    state = toggle(state, "pull-ups", 2, T0 + 1_000)
    expect(isWorkoutComplete(state)).toBe(true)
    expect(state.timer).toMatchObject({ status: "idle", deadline: null, kind: "set" })
  })

  it("never starts a rest when a set is unmarked", () => {
    let state = finishExercise(createInitialState("push"), "bench-press")
    expect(state.timer.kind).toBe("exercise")
    state = workoutReducer(state, { type: "skip" })

    state = toggle(state, "bench-press", 1, T0 + 5_000)
    expect(state.timer.status).toBe("idle")
    // Re-marking it completes the exercise again, so the long rest returns.
    state = toggle(state, "bench-press", 1, T0 + 6_000)
    expect(state.timer).toMatchObject({ status: "running", kind: "exercise" })
  })

  it("edits only the kind they belong to while a rest is running", () => {
    // An exercise rest is running: picking a between-set preset must not touch it.
    let state = finishExercise(createInitialState("push"), "bench-press")
    expect(state.timer).toMatchObject({ kind: "exercise", durationSeconds: 180 })

    state = workoutReducer(state, { type: "select-duration", seconds: 120, now: T0 + 10_000 })
    expect(state.timer).toMatchObject({
      kind: "exercise",
      durationSeconds: 180,
      deadline: T0 + 180_000,
    })
    expect(restSecondsFor(state, "set")).toBe(120)

    // Editing the exercise rest, however, restarts it.
    state = workoutReducer(state, {
      type: "select-duration",
      seconds: 240,
      now: T0 + 20_000,
      kind: "exercise",
    })
    expect(state.timer).toMatchObject({
      status: "running",
      kind: "exercise",
      durationSeconds: 240,
      deadline: T0 + 20_000 + 240_000,
    })

    // The mirror image: a between-set rest is immune to the exercise duration.
    let setRest = toggle(createInitialState("push"), "bench-press", 0)
    setRest = workoutReducer(setRest, {
      type: "select-duration",
      seconds: 300,
      now: T0 + 5_000,
      kind: "exercise",
    })
    expect(setRest.timer).toMatchObject({
      kind: "set",
      durationSeconds: 90,
      deadline: T0 + 90_000,
    })
    expect(restSecondsFor(setRest, "exercise")).toBe(300)
  })

  it("keeps a paused rest paused when its own kind is re-timed", () => {
    let state = finishExercise(createInitialState("push"), "bench-press")
    state = workoutReducer(state, { type: "pause", now: T0 + 10_000 })
    state = workoutReducer(state, {
      type: "select-duration",
      seconds: 200,
      now: T0 + 20_000,
      kind: "exercise",
    })
    expect(state.timer).toMatchObject({ status: "paused", remainingMs: 200_000, kind: "exercise" })
  })

  it("works the same in a saved workout, whose set rest comes from the snapshot", () => {
    let state = createInitialState(createSavedChoice())
    expect(restSecondsFor(state, "set")).toBe(100)
    expect(restSecondsFor(state, "exercise")).toBe(180)
    // A snapshot rest that is not a preset is the custom duration.
    expect(state.rest).toMatchObject({ mode: "custom", customSeconds: 100 })

    state = toggle(state, "b", 0)
    expect(state.timer).toMatchObject({ kind: "set", durationSeconds: 100 })
    state = toggle(state, "b", 1, T0 + 1_000)
    expect(state.timer).toMatchObject({ kind: "exercise", durationSeconds: 180 })

    const restored = parseState(serializeState(state), T0 + 2_000)!
    expect(restored.timer.kind).toBe("exercise")
    expect(restored.snapshot?.restSeconds).toBe(100)
  })
})

describe("the overall workout clock", () => {
  it("does not start on mount, on a selection or on an edit", () => {
    let state = createInitialState("push")
    expect(state.clock).toEqual({ startedAt: null, finishedAt: null })
    expect(isClockRunning(state)).toBe(false)
    expect(elapsedMs(state, T0 + 600_000)).toBe(0)

    state = workoutReducer(state, { type: "set-weight", exerciseId: "bench-press", value: "40" })
    state = workoutReducer(state, { type: "set-reps", exerciseId: "bench-press", value: "8" })
    state = workoutReducer(state, { type: "select-duration", seconds: 120, now: T0 })
    state = workoutReducer(state, { type: "set-sound", enabled: false })
    expect(state.clock.startedAt).toBeNull()
    expect(elapsedMs(state, T0 + 600_000)).toBe(0)
  })

  it("starts on the first newly marked set and keeps that start", () => {
    let state = toggle(createInitialState("push"), "bench-press", 0, T0)
    expect(state.clock).toEqual({ startedAt: T0, finishedAt: null })
    expect(isClockRunning(state)).toBe(true)
    expect(elapsedMs(state, T0 + 65_000)).toBe(65_000)

    // Later marks do not move the start.
    state = toggle(state, "bench-press", 1, T0 + 120_000)
    expect(state.clock.startedAt).toBe(T0)
    expect(elapsedMs(state, T0 + 180_000)).toBe(180_000)
  })

  it("keeps running through rests, pauses and a switched-off timer", () => {
    let state = toggle(createInitialState("push"), "bench-press", 0, T0)
    state = workoutReducer(state, { type: "pause", now: T0 + 10_000 })
    expect(elapsedMs(state, T0 + 300_000)).toBe(300_000)

    state = workoutReducer(state, { type: "set-timer-enabled", enabled: false })
    expect(isClockRunning(state)).toBe(true)
    expect(elapsedMs(state, T0 + 600_000)).toBe(600_000)
  })

  it("is not erased by unmarking every set", () => {
    let state = toggle(createInitialState("push"), "bench-press", 0, T0)
    state = toggle(state, "bench-press", 0, T0 + 30_000)
    expect(state.completed["bench-press"]).toEqual([false, false, false])
    expect(state.clock.startedAt).toBe(T0)
    expect(elapsedMs(state, T0 + 60_000)).toBe(60_000)
  })

  it("freezes when the last selected set is marked", () => {
    const done = markAll(createInitialState("push"), T0)
    expect(done.clock).toEqual({ startedAt: T0, finishedAt: T0 })
    expect(isClockRunning(done)).toBe(false)
    expect(elapsedMs(done, T0 + 600_000)).toBe(0)

    // A real session: the final mark happens later than the first.
    let state = createInitialState("push")
    state = toggle(state, "bench-press", 0, T0)
    for (const exercise of PUSH.exercises) {
      for (let index = 0; index < exercise.sets; index += 1) {
        if (exercise.id === "bench-press" && index === 0) continue
        state = toggle(state, exercise.id, index, T0 + 3_600_000)
      }
    }
    expect(elapsedMs(state, T0 + 9_999_999)).toBe(3_600_000)
    expect(formatClock(elapsedMs(state, T0 + 9_999_999))).toBe("01:00:00")
  })

  it("resumes from the original start after an undo, then freezes again", () => {
    let state = markAll(createInitialState("push"), T0)
    expect(state.clock.finishedAt).toBe(T0)

    state = toggle(state, "pull-ups", 2, T0 + 60_000)
    expect(isWorkoutComplete(state)).toBe(false)
    expect(state.clock).toEqual({ startedAt: T0, finishedAt: null })
    expect(elapsedMs(state, T0 + 120_000)).toBe(120_000)

    state = toggle(state, "pull-ups", 2, T0 + 180_000)
    expect(isWorkoutComplete(state)).toBe(true)
    expect(state.clock).toEqual({ startedAt: T0, finishedAt: T0 + 180_000 })
    expect(elapsedMs(state, T0 + 900_000)).toBe(180_000)
  })

  it("is cleared by a reset, a workout switch and starting a saved workout", () => {
    const started = toggle(createInitialState("push"), "bench-press", 0, T0)

    for (const next of [
      workoutReducer(started, { type: "reset" }),
      workoutReducer(started, { type: "select-workout", workoutId: "legs" }),
      workoutReducer(started, { type: "start-saved-workout", workout: createSavedChoice() }),
    ]) {
      expect(next.clock).toEqual({ startedAt: null, finishedAt: null })
      expect(elapsedMs(next, T0 + 600_000)).toBe(0)
    }
  })

  it("survives a reload, and refuses a nonsensical pair of timestamps", () => {
    const started = toggle(createInitialState("push"), "bench-press", 0, T0)
    const restored = parseState(serializeState(started), T0 + 300_000)!
    expect(restored.clock).toEqual({ startedAt: T0, finishedAt: null })
    expect(elapsedMs(restored, T0 + 300_000)).toBe(300_000)

    const frozen = parseState(serializeState(markAll(started, T0 + 60_000)), T0 + 900_000)!
    expect(frozen.clock).toEqual({ startedAt: T0, finishedAt: T0 + 60_000 })
    expect(elapsedMs(frozen, T0 + 900_000)).toBe(60_000)

    const broken = (clock: unknown) => {
      const raw = JSON.parse(serializeState(started)) as Record<string, unknown>
      raw.clock = clock
      return parseState(JSON.stringify(raw), T0)!
    }
    for (const clock of [
      { startedAt: "soon", finishedAt: null },
      { startedAt: Number.NaN, finishedAt: null },
      { startedAt: -1, finishedAt: null },
      { startedAt: T0, finishedAt: T0 - 1 },
      { startedAt: T0, finishedAt: true },
      // JSON turns NaN/Infinity into null, which reads as "not finished yet".
      { startedAt: Infinity, finishedAt: null },
      { startedAt: null, finishedAt: T0 },
      "nope",
      null,
    ]) {
      const parsed = broken(clock)
      // Only the clock falls back; the session itself is intact.
      expect(parsed.clock).toEqual({ startedAt: null, finishedAt: null })
      expect(parsed.completed["bench-press"]).toEqual([true, false, false])
    }
  })

  it("renders as HH:MM:SS, truncating part-seconds", () => {
    expect(formatClock(0)).toBe("00:00:00")
    expect(formatClock(999)).toBe("00:00:00")
    expect(formatClock(1_000)).toBe("00:00:01")
    expect(formatClock(61_500)).toBe("00:01:01")
    expect(formatClock(3_600_000)).toBe("01:00:00")
    expect(formatClock(36_000_000 + 2_521_000)).toBe("10:42:01")
    expect(formatClock(-5)).toBe("00:00:00")
  })
})

describe("reading a record written before these controls existed", () => {
  /** Exactly what the released version 3 wrote: no settings, no clock, no kind. */
  const legacyV3 = {
    version: SCHEMA_VERSION,
    workoutId: "pull",
    completed: {
      "lat-pulldown-wide": [true, true, false],
      "seated-row": [true, false, false],
      "bent-over-row": [false, false, false],
      "rear-delt-raise": [false, false, false],
      shrugs: [false, false, false],
      "biceps-curl": [false, false, false],
      "back-hyperextension": [false, false, false],
    },
    weights: {
      "lat-pulldown-wide": "35",
      "seated-row": "",
      "bent-over-row": "",
      "rear-delt-raise": "",
      shrugs: "20",
      "biceps-curl": "",
      "back-hyperextension": "",
    },
    reps: {
      "lat-pulldown-wide": "10",
      "seated-row": "12–15",
      "bent-over-row": "12–15",
      "rear-delt-raise": "12–15",
      shrugs: "12–15",
      "biceps-curl": "12–15",
      "back-hyperextension": "12–15",
    },
    setCounts: {},
    soundEnabled: false,
    timer: { status: "running", durationSeconds: 60, deadline: T0 + 60_000, remainingMs: null },
  }

  it("keeps every mark, edit and the running rest", () => {
    const state = parseState(JSON.stringify(legacyV3), T0 + 30_000)!

    expect(state.workoutId).toBe("pull")
    expect(state.completed["lat-pulldown-wide"]).toEqual([true, true, false])
    expect(state.completed["seated-row"]).toEqual([true, false, false])
    expect(state.weights["lat-pulldown-wide"]).toBe("35")
    expect(state.reps["lat-pulldown-wide"]).toBe("10")
    expect(state.soundEnabled).toBe(false)
    expect(state.timer).toMatchObject({
      status: "running",
      durationSeconds: 60,
      deadline: T0 + 60_000,
    })
  })

  it("defaults the new fields: timer on, 60 s as the custom duration, no clock", () => {
    const state = parseState(JSON.stringify(legacyV3), T0 + 30_000)!

    expect(state.timerEnabled).toBe(true)
    // The rest it was running is not a preset any more, so it is the custom one.
    expect(state.rest).toMatchObject({ mode: "custom", customSeconds: 60, presetSeconds: 90 })
    expect(restSecondsFor(state, "set")).toBe(60)
    expect(restSecondsFor(state, "exercise")).toBe(180)
    expect(state.timer.kind).toBe("set")
    // No workout time is invented for a session that never recorded one.
    expect(state.clock).toEqual({ startedAt: null, finishedAt: null })
    expect(elapsedMs(state, T0 + 600_000)).toBe(0)
  })

  it("keeps a stored 90 or 120 as a clean preset", () => {
    for (const durationSeconds of [90, 120]) {
      const raw = { ...legacyV3, timer: { ...legacyV3.timer, durationSeconds } }
      expect(parseState(JSON.stringify(raw), T0)!.rest).toMatchObject({
        mode: "preset",
        presetSeconds: durationSeconds,
      })
    }
  })

  it("falls back field by field when only the new fields are broken", () => {
    const raw = {
      ...legacyV3,
      timerEnabled: "yes",
      rest: { mode: "sideways", presetSeconds: 77, customSeconds: 0, exerciseSeconds: 99_999 },
      clock: { startedAt: T0, finishedAt: "later" },
    }
    const state = parseState(JSON.stringify(raw), T0 + 30_000)!

    expect(state.timerEnabled).toBe(true)
    expect(state.rest).toMatchObject({
      mode: "custom", // derived from the 60 s timer
      presetSeconds: 90,
      customSeconds: 60,
      exerciseSeconds: 180,
    })
    expect(state.clock).toEqual({ startedAt: null, finishedAt: null })
    // And nothing of the session was thrown away over it.
    expect(state.completed["lat-pulldown-wide"]).toEqual([true, true, false])
    expect(state.weights.shrugs).toBe("20")
  })

  it("stays at schema version 3 when written back", () => {
    const written = JSON.parse(serializeState(parseState(JSON.stringify(legacyV3), T0)!))
    expect(written.version).toBe(3)
    expect(written).toMatchObject({ timerEnabled: true, clock: { startedAt: null } })
    expect(written.rest).toMatchObject({ mode: "custom", customSeconds: 60 })
  })
})

/** A saved workout with a non-preset rest and an exercise offering a choice. */
function createSavedChoice() {
  return {
    id: "user:custom" as const,
    label: "Своя",
    title: "Своя тренировка",
    restSeconds: 100,
    soundEnabled: true,
    exercises: [
      { id: "a", name: "Присед", sets: 3, setOptions: [2, 3, 4], reps: "8", weight: "40" },
      { id: "b", name: "Тяга", sets: 2, reps: "10", weight: "" },
    ],
  }
}
