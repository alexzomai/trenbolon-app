import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  SCHEMA_VERSION,
  STORAGE_KEY,
  clearState,
  loadOrCreateState,
  loadState,
  parseState,
  saveState,
  serializeState,
} from "./workout-storage"
import {
  countCompleted,
  createInitialState,
  remainingMs,
  setsFor,
  totalSets,
  workoutReducer,
  type WorkoutState,
} from "./workout-state"
import { getWorkout } from "./workout-plan"

const T0 = 1_700_000_000_000

function write(value: unknown) {
  window.localStorage.setItem(
    STORAGE_KEY,
    typeof value === "string" ? value : JSON.stringify(value)
  )
}

/** A valid stored record for the Push day, with optional overrides. */
function validRecord(overrides: Record<string, unknown> = {}) {
  return {
    ...JSON.parse(serializeState(createInitialState("push"))),
    ...overrides,
  }
}

const pushDefaults = () => createInitialState("push")

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("roundtrip", () => {
  it("restores the workout, marks, edits, preset and sound preference", () => {
    let state = createInitialState("push")
    state = workoutReducer(state, {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 0,
      now: T0,
    })
    state = workoutReducer(state, {
      type: "toggle-set",
      exerciseId: "pec-deck",
      setIndex: 2,
      now: T0,
    })
    state = workoutReducer(state, {
      type: "set-weight",
      exerciseId: "incline-press",
      value: "20–25",
    })
    state = workoutReducer(state, { type: "set-reps", exerciseId: "pec-deck", value: "8" })
    state = workoutReducer(state, { type: "set-sound", enabled: false })
    state = workoutReducer(state, { type: "select-duration", seconds: 120, now: T0 })

    expect(saveState(state)).toBe(true)
    const restored = loadState(T0 + 1_000)

    expect(restored).not.toBeNull()
    expect(restored!.workoutId).toBe("push")
    expect(countCompleted(restored!)).toBe(2)
    expect(restored!.completed["bench-press"]).toEqual([true, false, false])
    expect(restored!.completed["pec-deck"]).toEqual([false, false, true])
    expect(restored!.weights["incline-press"]).toBe("20–25")
    expect(restored!.reps["pec-deck"]).toBe("8")
    expect(restored!.soundEnabled).toBe(false)
    expect(restored!.timer.durationSeconds).toBe(120)
  })

  it("remembers which workout was selected", () => {
    for (const id of ["pull", "push", "legs"] as const) {
      saveState(createInitialState(id))
      const restored = loadState(T0)!
      expect(restored.workoutId).toBe(id)
      expect(restored).toEqual(createInitialState(id))
    }
  })

  it("restores the chosen set count, and with it the real total", () => {
    const state = workoutReducer(createInitialState("push"), {
      type: "set-sets",
      exerciseId: "pec-deck",
      count: 2,
    })
    saveState(state)

    const restored = loadState(T0)!
    expect(setsFor(restored, getWorkout("push").exercises[4])).toBe(2)
    expect(totalSets(restored)).toBe(17)
  })

  it("never persists a pending beep", () => {
    let state = workoutReducer(createInitialState("push"), {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 0,
      now: T0,
    })
    state = workoutReducer(state, { type: "tick", now: T0 + 90_000 })
    expect(state.beepAt).toBe(T0 + 90_000)

    saveState(state)
    expect(serializeState(state)).not.toContain("beepAt")
    expect(loadState(T0 + 90_001)!.beepAt).toBeNull()
  })

  it("writes a versioned record naming the workout", () => {
    saveState(createInitialState("legs"))
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)
    expect(raw.version).toBe(SCHEMA_VERSION)
    expect(SCHEMA_VERSION).toBe(2)
    expect(raw.workoutId).toBe("legs")
  })

  it("keeps a single record: a switched session overwrites the previous one", () => {
    let state = workoutReducer(createInitialState("pull"), {
      type: "toggle-set",
      exerciseId: "lat-pulldown-wide",
      setIndex: 0,
      now: T0,
    })
    saveState(state)

    state = workoutReducer(state, { type: "select-workout", workoutId: "push" })
    saveState(state)

    expect(window.localStorage.length).toBe(1)
    const restored = loadState(T0)!
    expect(restored.workoutId).toBe("push")
    expect(countCompleted(restored)).toBe(0)
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).not.toHaveProperty(
      "completed.lat-pulldown-wide"
    )
  })
})

describe("timer restore", () => {
  it("restores a running timer with the correct remaining time", () => {
    const state = workoutReducer(createInitialState("push"), {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 0,
      now: T0,
    })
    saveState(state)

    // Page reopened 30 s later.
    const restored = loadState(T0 + 30_000)!
    expect(restored.timer.status).toBe("running")
    expect(restored.timer.deadline).toBe(T0 + 90_000)
    expect(remainingMs(restored.timer, T0 + 30_000)).toBe(60_000)
  })

  it("restores an expired timer as finished without replaying the beep", () => {
    const state = workoutReducer(createInitialState("push"), {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 0,
      now: T0,
    })
    saveState(state)

    // Page reopened long after the rest was over.
    const restored = loadState(T0 + 10 * 60_000)!
    expect(restored.timer.status).toBe("finished")
    expect(restored.timer.deadline).toBeNull()
    expect(remainingMs(restored.timer, T0 + 10 * 60_000)).toBe(0)
    expect(restored.beepAt).toBeNull()
  })

  it("restores an already-finished timer without a beep", () => {
    let state = workoutReducer(createInitialState("push"), {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 0,
      now: T0,
    })
    state = workoutReducer(state, { type: "tick", now: T0 + 90_000 })
    saveState(state)

    const restored = loadState(T0 + 90_100)!
    expect(restored.timer.status).toBe("finished")
    expect(restored.beepAt).toBeNull()
  })

  it("restores a paused timer with its frozen remainder regardless of elapsed time", () => {
    let state = workoutReducer(createInitialState("push"), {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 0,
      now: T0,
    })
    state = workoutReducer(state, { type: "pause", now: T0 + 25_000 })
    saveState(state)

    const restored = loadState(T0 + 3 * 60 * 60_000)!
    expect(restored.timer.status).toBe("paused")
    expect(restored.timer.remainingMs).toBe(65_000)
    expect(remainingMs(restored.timer, T0 + 3 * 60 * 60_000)).toBe(65_000)
  })

  it("restores an idle timer as ready to start", () => {
    const state = workoutReducer(createInitialState("push"), {
      type: "select-duration",
      seconds: 180,
      now: T0,
    })
    saveState(state)

    const restored = loadState(T0 + 1_000)!
    expect(restored.timer.status).toBe("idle")
    expect(remainingMs(restored.timer, T0 + 1_000)).toBe(180_000)
  })
})

describe("corrupt and incompatible data", () => {
  it("falls back when nothing is stored", () => {
    expect(loadState(T0)).toBeNull()
    expect(loadOrCreateState(T0)).toEqual(createInitialState())
  })

  it.each([
    ["not JSON at all", "{not json"],
    ["truncated JSON", '{"version":2,"completed":'],
    ["an empty string", ""],
    ["a JSON array", "[]"],
    ["a JSON scalar", "42"],
    ["JSON null", "null"],
  ])("falls back on %s", (_label, raw) => {
    write(raw)
    expect(loadState(T0)).toBeNull()
    expect(loadOrCreateState(T0)).toEqual(createInitialState())
  })

  it.each([
    ["a missing version", validRecord({ version: undefined })],
    ["the superseded v1 schema", validRecord({ version: 1 })],
    ["a newer schema version", validRecord({ version: SCHEMA_VERSION + 1 })],
    ["a missing workout id", validRecord({ workoutId: undefined })],
    ["an unknown workout id", validRecord({ workoutId: "arms" })],
    ["a non-string workout id", validRecord({ workoutId: 2 })],
    ["missing completed marks", validRecord({ completed: undefined })],
    [
      "completed marks of the wrong length",
      validRecord({ completed: { ...pushDefaults().completed, "bench-press": [true, false] } }),
    ],
    [
      "non-boolean marks",
      validRecord({ completed: { ...pushDefaults().completed, "bench-press": [1, 0, 1] } }),
    ],
    [
      "marks for an exercise of another workout",
      validRecord({ completed: { "lat-pulldown-wide": [false, false, false, false] } }),
    ],
    ["an exercise's marks missing", validRecord({ completed: { "bench-press": [false, false, false] } })],
    ["non-string weights", validRecord({ weights: { ...pushDefaults().weights, "pec-deck": 42 } })],
    ["missing reps", validRecord({ reps: undefined })],
    ["a non-boolean sound flag", validRecord({ soundEnabled: "yes" })],
    ["a missing timer", validRecord({ timer: undefined })],
    [
      "an unknown timer status",
      validRecord({ timer: { status: "sprinting", durationSeconds: 90, deadline: null, remainingMs: null } }),
    ],
    [
      "a non-preset duration",
      validRecord({ timer: { status: "idle", durationSeconds: 45, deadline: null, remainingMs: null } }),
    ],
    [
      "a running timer with no deadline",
      validRecord({ timer: { status: "running", durationSeconds: 90, deadline: null, remainingMs: null } }),
    ],
    [
      "a paused timer with no remainder",
      validRecord({ timer: { status: "paused", durationSeconds: 90, deadline: null, remainingMs: null } }),
    ],
    [
      "a NaN deadline",
      validRecord({ timer: { status: "running", durationSeconds: 90, deadline: "soon", remainingMs: null } }),
    ],
  ])("falls back on %s", (_label, record) => {
    write(record)
    expect(loadState(T0)).toBeNull()
    expect(loadOrCreateState(T0)).toEqual(createInitialState())
  })

  it("ignores extra unknown keys in an otherwise valid record", () => {
    write(validRecord({ somethingNew: { nested: true } }))
    expect(loadState(T0)).toEqual(createInitialState("push"))
  })

  it.each([
    ["missing", undefined],
    ["not an object", 3],
    ["a count the plan does not offer", { "pec-deck": 5 }],
    ["a non-numeric count", { "pec-deck": "2" }],
  ])("keeps the progress and defaults the set count when setCounts is %s", (_label, setCounts) => {
    let state = workoutReducer(createInitialState("push"), {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 0,
      now: T0,
    })
    state = workoutReducer(state, { type: "skip" })
    write({ ...JSON.parse(serializeState(state)), setCounts })

    const restored = loadState(T0)
    expect(restored).not.toBeNull()
    expect(countCompleted(restored!)).toBe(1)
    expect(restored!.setCounts).toEqual({ "pec-deck": 3 })
    expect(totalSets(restored!)).toBe(18)
  })

  it("parses directly from a raw string too", () => {
    expect(parseState(null, T0)).toBeNull()
    expect(parseState("{", T0)).toBeNull()
    expect(parseState(serializeState(createInitialState("legs")), T0)).toEqual(
      createInitialState("legs")
    )
  })
})

describe("unavailable storage", () => {
  it("returns null instead of throwing when reading throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError")
    })
    expect(loadState(T0)).toBeNull()
    expect(loadOrCreateState(T0)).toEqual(createInitialState())
  })

  it("reports failure instead of throwing when writing throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError")
    })
    expect(saveState(createInitialState())).toBe(false)
  })

  it("reports failure instead of throwing when clearing throws", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError")
    })
    expect(clearState()).toBe(false)
  })
})

describe("reset", () => {
  it("removes the saved record so a reload starts fresh", () => {
    const state: WorkoutState = workoutReducer(createInitialState(), {
      type: "toggle-set",
      exerciseId: "lat-pulldown-wide",
      setIndex: 0,
      now: T0,
    })
    saveState(state)
    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull()

    expect(clearState()).toBe(true)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(loadState(T0)).toBeNull()
    expect(loadOrCreateState(T0)).toEqual(createInitialState())
  })
})
