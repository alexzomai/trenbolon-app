import { describe, expect, it } from "vitest"

import {
  DEFAULT_REST_SECONDS,
  EXERCISES,
  TOTAL_SETS,
} from "./workout-plan"
import {
  buildResultsText,
  countCompleted,
  countCompletedFor,
  createInitialState,
  formatDuration,
  isWorkoutComplete,
  normalizeTimer,
  progressPercent,
  remainingMs,
  workoutReducer,
  type WorkoutState,
} from "./workout-state"

const T0 = 1_700_000_000_000

function markAll(state: WorkoutState, now = T0): WorkoutState {
  let next = state
  for (const exercise of EXERCISES) {
    for (let setIndex = 0; setIndex < exercise.sets; setIndex += 1) {
      next = workoutReducer(next, {
        type: "toggle-set",
        exerciseId: exercise.id,
        setIndex,
        now,
      })
    }
  }
  return next
}

describe("plan", () => {
  it("has 5 exercises of 3 sets each, 15 in total", () => {
    expect(EXERCISES).toHaveLength(5)
    expect(EXERCISES.every((exercise) => exercise.sets === 3)).toBe(true)
    expect(TOTAL_SETS).toBe(15)
  })
})

describe("initial state", () => {
  it("is deterministic and reads no clock", () => {
    expect(createInitialState()).toEqual(createInitialState())
  })

  it("seeds weights and reps from the plan", () => {
    const state = createInitialState()
    expect(state.weights["bench-press"]).toBe("10–13")
    expect(state.weights["incline-press"]).toBe("")
    expect(state.reps["lateral-raise"]).toBe("12–15")
    expect(state.weights["pec-deck"]).toBe("42–45")
  })

  it("starts idle with the 90 s preset, sound on and no pending beep", () => {
    const state = createInitialState()
    expect(state.timer.status).toBe("idle")
    expect(state.timer.durationSeconds).toBe(DEFAULT_REST_SECONDS)
    expect(state.soundEnabled).toBe(true)
    expect(state.beepAt).toBeNull()
  })
})

describe("progress", () => {
  it("counts marked sets overall and per exercise", () => {
    let state = createInitialState()
    state = workoutReducer(state, {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 0,
      now: T0,
    })
    state = workoutReducer(state, {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 2,
      now: T0,
    })
    state = workoutReducer(state, {
      type: "toggle-set",
      exerciseId: "pec-deck",
      setIndex: 1,
      now: T0,
    })

    expect(countCompleted(state)).toBe(3)
    expect(countCompletedFor(state, "bench-press")).toBe(2)
    expect(countCompletedFor(state, "pec-deck")).toBe(1)
    expect(countCompletedFor(state, "incline-press")).toBe(0)
  })

  it("rounds the percentage to whole numbers", () => {
    let state = createInitialState()
    expect(progressPercent(state)).toBe(0)

    state = workoutReducer(state, {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 0,
      now: T0,
    })
    expect(progressPercent(state)).toBe(7) // 1/15 = 6.66…

    state = workoutReducer(state, {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 1,
      now: T0,
    })
    expect(progressPercent(state)).toBe(13) // 2/15 = 13.33…

    expect(progressPercent(markAll(createInitialState()))).toBe(100)
  })

  it("toggles a set back off without changing anything else", () => {
    const base = createInitialState()
    const marked = workoutReducer(base, {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 0,
      now: T0,
    })
    const unmarked = workoutReducer(marked, {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 0,
      now: T0 + 5_000,
    })

    expect(countCompleted(unmarked)).toBe(0)
    expect(unmarked.completed).toEqual(base.completed)
  })

  it("ignores unknown exercises and out-of-range set indexes", () => {
    const state = createInitialState()
    expect(
      workoutReducer(state, { type: "toggle-set", exerciseId: "nope", setIndex: 0, now: T0 })
    ).toBe(state)
    expect(
      workoutReducer(state, {
        type: "toggle-set",
        exerciseId: "bench-press",
        setIndex: 3,
        now: T0,
      })
    ).toBe(state)
  })
})

describe("editable weight and reps", () => {
  it("stores free-form strings including ranges and empties", () => {
    let state = createInitialState()
    state = workoutReducer(state, {
      type: "set-weight",
      exerciseId: "incline-press",
      value: "20–25",
    })
    state = workoutReducer(state, { type: "set-reps", exerciseId: "incline-press", value: "" })

    expect(state.weights["incline-press"]).toBe("20–25")
    expect(state.reps["incline-press"]).toBe("")
  })

  it("ignores edits for unknown exercises", () => {
    const state = createInitialState()
    expect(workoutReducer(state, { type: "set-weight", exerciseId: "nope", value: "5" })).toBe(
      state
    )
    expect(workoutReducer(state, { type: "set-reps", exerciseId: "nope", value: "5" })).toBe(
      state
    )
  })
})

describe("rest timer", () => {
  it("starts a countdown when a set is newly marked", () => {
    const state = workoutReducer(createInitialState(), {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 0,
      now: T0,
    })

    expect(state.timer.status).toBe("running")
    expect(state.timer.deadline).toBe(T0 + 90_000)
    expect(remainingMs(state.timer, T0 + 10_000)).toBe(80_000)
  })

  it("restarts the countdown when the next set is marked", () => {
    let state = workoutReducer(createInitialState(), {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 0,
      now: T0,
    })
    state = workoutReducer(state, {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 1,
      now: T0 + 30_000,
    })

    expect(state.timer.status).toBe("running")
    expect(state.timer.deadline).toBe(T0 + 30_000 + 90_000)
  })

  it("does not start the timer when a set is unmarked", () => {
    let state = workoutReducer(createInitialState(), {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 0,
      now: T0,
    })
    state = workoutReducer(state, { type: "skip" })
    expect(state.timer.status).toBe("idle")

    state = workoutReducer(state, {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 0,
      now: T0 + 1_000,
    })
    expect(state.timer.status).toBe("idle")
  })

  it("stops the timer and completes the workout on the final set", () => {
    let state = createInitialState()
    // Mark 14 of 15 sets.
    for (const exercise of EXERCISES) {
      for (let setIndex = 0; setIndex < exercise.sets; setIndex += 1) {
        if (exercise.id === "pec-deck" && setIndex === 2) continue
        state = workoutReducer(state, {
          type: "toggle-set",
          exerciseId: exercise.id,
          setIndex,
          now: T0,
        })
      }
    }
    expect(countCompleted(state)).toBe(14)
    expect(state.timer.status).toBe("running")

    state = workoutReducer(state, {
      type: "toggle-set",
      exerciseId: "pec-deck",
      setIndex: 2,
      now: T0 + 1_000,
    })

    expect(isWorkoutComplete(state)).toBe(true)
    expect(state.timer.status).toBe("idle")
    expect(state.timer.deadline).toBeNull()
  })

  it("pauses by freezing the remainder and resumes from it", () => {
    let state = workoutReducer(createInitialState(), {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 0,
      now: T0,
    })

    state = workoutReducer(state, { type: "pause", now: T0 + 20_000 })
    expect(state.timer.status).toBe("paused")
    expect(state.timer.remainingMs).toBe(70_000)
    expect(state.timer.deadline).toBeNull()

    // Time passing while paused must not consume the remainder.
    expect(remainingMs(state.timer, T0 + 5_000_000)).toBe(70_000)

    state = workoutReducer(state, { type: "resume", now: T0 + 600_000 })
    expect(state.timer.status).toBe("running")
    expect(state.timer.deadline).toBe(T0 + 600_000 + 70_000)
  })

  it("ignores pause when idle and resume when not paused", () => {
    const state = createInitialState()
    expect(workoutReducer(state, { type: "pause", now: T0 })).toBe(state)
    expect(workoutReducer(state, { type: "resume", now: T0 })).toBe(state)
  })

  it("clears the timer on skip and keeps the chosen preset", () => {
    let state = workoutReducer(createInitialState(), {
      type: "select-duration",
      seconds: 120,
      now: T0,
    })
    state = workoutReducer(state, {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 0,
      now: T0,
    })
    state = workoutReducer(state, { type: "skip" })

    expect(state.timer.status).toBe("idle")
    expect(state.timer.deadline).toBeNull()
    expect(state.timer.remainingMs).toBeNull()
    expect(state.timer.durationSeconds).toBe(120)
  })

  it("finishes exactly at the deadline and requests one beep", () => {
    const started = workoutReducer(createInitialState(), {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 0,
      now: T0,
    })

    // A tick before the deadline is a no-op, so no re-render churn.
    expect(workoutReducer(started, { type: "tick", now: T0 + 89_999 })).toBe(started)

    const finished = workoutReducer(started, { type: "tick", now: T0 + 90_000 })
    expect(finished.timer.status).toBe("finished")
    expect(finished.timer.deadline).toBeNull()
    expect(finished.beepAt).toBe(T0 + 90_000)

    // Further ticks do nothing once finished.
    expect(workoutReducer(finished, { type: "tick", now: T0 + 95_000 })).toBe(finished)
  })

  it("does not request a beep when sound is off", () => {
    let state = workoutReducer(createInitialState(), { type: "set-sound", enabled: false })
    state = workoutReducer(state, {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 0,
      now: T0,
    })
    state = workoutReducer(state, { type: "tick", now: T0 + 90_000 })

    expect(state.timer.status).toBe("finished")
    expect(state.beepAt).toBeNull()
  })

  it("survives a throttled tab: one late tick still finishes the timer", () => {
    const started = workoutReducer(createInitialState(), {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 0,
      now: T0,
    })
    const finished = workoutReducer(started, { type: "tick", now: T0 + 600_000 })

    expect(finished.timer.status).toBe("finished")
    expect(remainingMs(finished.timer, T0 + 600_000)).toBe(0)
  })
})

describe("rest presets", () => {
  it("updates the duration while idle without starting anything", () => {
    const state = workoutReducer(createInitialState(), {
      type: "select-duration",
      seconds: 60,
      now: T0,
    })
    expect(state.timer.status).toBe("idle")
    expect(state.timer.durationSeconds).toBe(60)
    expect(remainingMs(state.timer, T0)).toBe(60_000)
  })

  it("restarts a running countdown against the new preset", () => {
    let state = workoutReducer(createInitialState(), {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 0,
      now: T0,
    })
    state = workoutReducer(state, { type: "select-duration", seconds: 180, now: T0 + 10_000 })

    expect(state.timer.status).toBe("running")
    expect(state.timer.durationSeconds).toBe(180)
    expect(state.timer.deadline).toBe(T0 + 10_000 + 180_000)
  })

  it("keeps a paused timer paused on the new preset", () => {
    let state = workoutReducer(createInitialState(), {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 0,
      now: T0,
    })
    state = workoutReducer(state, { type: "pause", now: T0 + 10_000 })
    state = workoutReducer(state, { type: "select-duration", seconds: 60, now: T0 + 20_000 })

    expect(state.timer.status).toBe("paused")
    expect(state.timer.durationSeconds).toBe(60)
    expect(state.timer.remainingMs).toBe(60_000)
  })

  it("rejects durations that are not presets", () => {
    const state = createInitialState()
    expect(workoutReducer(state, { type: "select-duration", seconds: 45, now: T0 })).toBe(state)
  })
})

describe("normalizeTimer", () => {
  it("collapses an expired running timer to finished without a beep", () => {
    const timer = normalizeTimer(
      { status: "running", durationSeconds: 90, deadline: T0, remainingMs: null },
      T0 + 1
    )
    expect(timer.status).toBe("finished")
    expect(timer.deadline).toBeNull()
  })

  it("leaves a still-running timer alone", () => {
    const original = {
      status: "running" as const,
      durationSeconds: 90,
      deadline: T0 + 10_000,
      remainingMs: null,
    }
    expect(normalizeTimer(original, T0)).toBe(original)
  })

  it("repairs a running timer that lost its deadline", () => {
    const timer = normalizeTimer(
      { status: "running", durationSeconds: 120, deadline: null, remainingMs: null },
      T0
    )
    expect(timer.status).toBe("idle")
    expect(timer.durationSeconds).toBe(120)
  })
})

describe("formatDuration", () => {
  it("renders MM:SS and rounds part-seconds up", () => {
    expect(formatDuration(90_000)).toBe("01:30")
    expect(formatDuration(60_000)).toBe("01:00")
    expect(formatDuration(180_000)).toBe("03:00")
    expect(formatDuration(1)).toBe("00:01")
    expect(formatDuration(0)).toBe("00:00")
    expect(formatDuration(-500)).toBe("00:00")
  })
})

describe("reset", () => {
  it("clears marks, edits, timer and restores the defaults", () => {
    let state = markAll(createInitialState())
    state = workoutReducer(state, { type: "set-weight", exerciseId: "pec-deck", value: "60" })
    state = workoutReducer(state, { type: "set-sound", enabled: false })
    state = workoutReducer(state, { type: "select-duration", seconds: 180, now: T0 })

    const reset = workoutReducer(state, { type: "reset" })

    expect(reset).toEqual(createInitialState())
    expect(countCompleted(reset)).toBe(0)
    expect(reset.weights["pec-deck"]).toBe("42–45")
    expect(reset.soundEnabled).toBe(true)
    expect(reset.timer.durationSeconds).toBe(90)
    expect(reset.timer.status).toBe("idle")
  })
})

describe("buildResultsText", () => {
  it("reports the live edited weights and reps", () => {
    let state = createInitialState()
    state = workoutReducer(state, {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 0,
      now: T0,
    })
    state = workoutReducer(state, {
      type: "set-weight",
      exerciseId: "bench-press",
      value: "15",
    })
    state = workoutReducer(state, { type: "set-reps", exerciseId: "bench-press", value: "6" })

    const text = buildResultsText(state)
    expect(text).toContain("Тренировка: грудь и плечи")
    expect(text).toContain("1. Жим лёжа — 3 × 6 повт., вес 15 кг — выполнено 1/3")
    expect(text).toContain("2. Жим на наклонной — 3 × 10 повт., вес не указан — выполнено 0/3")
    expect(text).toContain("Итого: 1 / 15 подходов (7%)")
    expect(text).toContain("Отдых между подходами: 90 с")
  })
})
