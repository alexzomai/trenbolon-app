import { describe, expect, it } from "vitest"

import {
  DEFAULT_REST_SECONDS,
  DEFAULT_WORKOUT_ID,
  getWorkout,
  type WorkoutId,
} from "./workout-plan"
import {
  buildResultsText,
  countCompleted,
  countCompletedFor,
  createInitialState,
  formatDuration,
  hiddenCompletedFor,
  isPristine,
  isWorkoutComplete,
  normalizeTimer,
  progressPercent,
  remainingMs,
  setsFor,
  totalSets,
  workoutReducer,
  type WorkoutState,
} from "./workout-state"

const T0 = 1_700_000_000_000

const PULL = getWorkout("pull")
const PUSH = getWorkout("push")
const LEGS = getWorkout("legs")

/** An exercise of the state's own workout, by id. */
function ex(state: WorkoutState, exerciseId: string) {
  return getWorkout(state.workoutId).exercises.find(
    (exercise) => exercise.id === exerciseId
  )!
}

function toggle(
  state: WorkoutState,
  exerciseId: string,
  setIndex: number,
  now = T0
): WorkoutState {
  return workoutReducer(state, { type: "toggle-set", exerciseId, setIndex, now })
}

/** Mark every set that counts in the current session. */
function markAll(state: WorkoutState, now = T0): WorkoutState {
  let next = state
  for (const exercise of getWorkout(state.workoutId).exercises) {
    for (let setIndex = 0; setIndex < setsFor(next, exercise); setIndex += 1) {
      next = toggle(next, exercise.id, setIndex, now)
    }
  }
  return next
}

describe("initial state", () => {
  it("is deterministic and reads no clock", () => {
    expect(createInitialState()).toEqual(createInitialState())
  })

  it("starts on the default workout", () => {
    expect(createInitialState().workoutId).toBe(DEFAULT_WORKOUT_ID)
    expect(DEFAULT_WORKOUT_ID).toBe("pull")
  })

  it("seeds weights and reps from the plan, including free text", () => {
    const push = createInitialState("push")
    expect(push.weights["bench-press"]).toBe("10–13")
    expect(push.weights["incline-press"]).toBe("")
    expect(push.reps["lateral-raise"]).toBe("12–15")
    expect(push.weights["pec-deck"]).toBe("42–45")
    expect(push.reps["triceps-extension"]).toBe("до отказа")

    const legs = createInitialState("legs")
    expect(legs.weights["decline-crunch"]).toBe("свой вес")
    expect(legs.reps["plank"]).toBe("до отказа")
  })

  it("allocates one mark per planned set, including the four-set row", () => {
    const pull = createInitialState("pull")
    expect(pull.completed["lat-pulldown-wide"]).toEqual([false, false, false, false])
    expect(pull.completed["shrugs"]).toEqual([false, false, false])
  })

  it("starts idle with the 90 s preset, sound on and no pending beep", () => {
    const state = createInitialState("push")
    expect(state.timer.status).toBe("idle")
    expect(state.timer.durationSeconds).toBe(DEFAULT_REST_SECONDS)
    expect(state.soundEnabled).toBe(true)
    expect(state.beepAt).toBeNull()
  })

  it("defaults the variable-set exercise to three sets and nothing else", () => {
    expect(createInitialState("push").setCounts).toEqual({ "pec-deck": 3 })
    expect(createInitialState("pull").setCounts).toEqual({})
  })
})

describe("totals per workout", () => {
  it("counts 19 for Pull, 18 for Push and 18 for Legs", () => {
    expect(totalSets(createInitialState("pull"))).toBe(19)
    expect(totalSets(createInitialState("push"))).toBe(18)
    expect(totalSets(createInitialState("legs"))).toBe(18)
  })
})

describe("progress", () => {
  it("counts marked sets overall and per exercise", () => {
    let state = createInitialState("push")
    state = toggle(state, "bench-press", 0)
    state = toggle(state, "bench-press", 2)
    state = toggle(state, "pec-deck", 1)

    expect(countCompleted(state)).toBe(3)
    expect(countCompletedFor(state, ex(state, "bench-press"))).toBe(2)
    expect(countCompletedFor(state, ex(state, "pec-deck"))).toBe(1)
    expect(countCompletedFor(state, ex(state, "incline-press"))).toBe(0)
  })

  it("rounds the percentage to whole numbers", () => {
    let state = createInitialState("push")
    expect(progressPercent(state)).toBe(0)

    state = toggle(state, "bench-press", 0)
    expect(progressPercent(state)).toBe(6) // 1/18 = 5.55…

    state = toggle(state, "bench-press", 1)
    expect(progressPercent(state)).toBe(11) // 2/18 = 11.11…

    const done = markAll(createInitialState("push"))
    expect(countCompleted(done)).toBe(18)
    expect(progressPercent(done)).toBe(100)
  })

  it("counts all 19 sets of the Pull day", () => {
    const done = markAll(createInitialState("pull"))
    expect(countCompleted(done)).toBe(19)
    expect(progressPercent(done)).toBe(100)
    expect(isWorkoutComplete(done)).toBe(true)
  })

  it("toggles a set back off without changing anything else", () => {
    const base = createInitialState("push")
    const marked = toggle(base, "bench-press", 0)
    const unmarked = toggle(marked, "bench-press", 0, T0 + 5_000)

    expect(countCompleted(unmarked)).toBe(0)
    expect(unmarked.completed).toEqual(base.completed)
  })

  it("ignores unknown exercises, out-of-range indexes and other workouts", () => {
    const state = createInitialState("push")
    expect(toggle(state, "nope", 0)).toBe(state)
    expect(toggle(state, "bench-press", 3)).toBe(state)
    expect(toggle(state, "bench-press", -1)).toBe(state)
    // Pull's first exercise is not part of the Push session.
    expect(toggle(state, "lat-pulldown-wide", 0)).toBe(state)
  })
})

describe("variable set count", () => {
  it("lets the butterfly drop to two sets, shrinking total and progress", () => {
    let state = createInitialState("push")
    state = workoutReducer(state, { type: "set-sets", exerciseId: "pec-deck", count: 2 })

    expect(setsFor(state, ex(state, "pec-deck"))).toBe(2)
    expect(totalSets(state)).toBe(17)

    state = markAll(state)
    expect(countCompleted(state)).toBe(17)
    expect(progressPercent(state)).toBe(100)
    expect(isWorkoutComplete(state)).toBe(true)
  })

  it("parks a discarded third mark and brings it back deterministically", () => {
    let state = createInitialState("push")
    state = toggle(state, "pec-deck", 2)
    expect(countCompleted(state)).toBe(1)

    state = workoutReducer(state, { type: "set-sets", exerciseId: "pec-deck", count: 2 })
    // Out of range of the chosen two sets: not counted, but not thrown away.
    expect(countCompleted(state)).toBe(0)
    expect(countCompletedFor(state, ex(state, "pec-deck"))).toBe(0)
    expect(hiddenCompletedFor(state, ex(state, "pec-deck"))).toBe(1)
    expect(state.completed["pec-deck"]).toEqual([false, false, true])

    state = workoutReducer(state, { type: "set-sets", exerciseId: "pec-deck", count: 3 })
    expect(countCompleted(state)).toBe(1)
    expect(hiddenCompletedFor(state, ex(state, "pec-deck"))).toBe(0)
  })

  it("refuses to mark a set beyond the chosen count", () => {
    let state = createInitialState("push")
    state = workoutReducer(state, { type: "set-sets", exerciseId: "pec-deck", count: 2 })
    expect(toggle(state, "pec-deck", 2)).toBe(state)
  })

  it("ignores counts the plan does not offer, and exercises with no choice", () => {
    const state = createInitialState("push")
    expect(workoutReducer(state, { type: "set-sets", exerciseId: "pec-deck", count: 4 })).toBe(
      state
    )
    expect(workoutReducer(state, { type: "set-sets", exerciseId: "pec-deck", count: 0 })).toBe(
      state
    )
    expect(workoutReducer(state, { type: "set-sets", exerciseId: "pec-deck", count: 3 })).toBe(
      state
    )
    expect(
      workoutReducer(state, { type: "set-sets", exerciseId: "bench-press", count: 2 })
    ).toBe(state)
  })

  it("finishes the workout on the last set of a reduced plan", () => {
    let state = createInitialState("push")
    state = workoutReducer(state, { type: "set-sets", exerciseId: "pec-deck", count: 2 })

    // 16 of 17 sets.
    for (const exercise of PUSH.exercises) {
      for (let setIndex = 0; setIndex < setsFor(state, exercise); setIndex += 1) {
        if (exercise.id === "pec-deck" && setIndex === 1) continue
        state = toggle(state, exercise.id, setIndex)
      }
    }
    expect(countCompleted(state)).toBe(16)
    expect(state.timer.status).toBe("running")

    state = toggle(state, "pec-deck", 1, T0 + 1_000)
    expect(isWorkoutComplete(state)).toBe(true)
    expect(state.timer.status).toBe("idle")
  })
})

describe("editable weight and reps", () => {
  it("stores free-form strings including ranges and empties", () => {
    let state = createInitialState("push")
    state = workoutReducer(state, {
      type: "set-weight",
      exerciseId: "incline-press",
      value: "20–25",
    })
    state = workoutReducer(state, { type: "set-reps", exerciseId: "incline-press", value: "" })

    expect(state.weights["incline-press"]).toBe("20–25")
    expect(state.reps["incline-press"]).toBe("")
  })

  it("accepts textual reps and bodyweight", () => {
    let state = createInitialState("legs")
    state = workoutReducer(state, { type: "set-reps", exerciseId: "plank", value: "до отказа" })
    state = workoutReducer(state, {
      type: "set-weight",
      exerciseId: "decline-crunch",
      value: "свой вес",
    })

    expect(state.reps["plank"]).toBe("до отказа")
    expect(state.weights["decline-crunch"]).toBe("свой вес")
  })

  it("ignores edits for exercises outside the current workout", () => {
    const state = createInitialState("push")
    expect(workoutReducer(state, { type: "set-weight", exerciseId: "nope", value: "5" })).toBe(
      state
    )
    expect(workoutReducer(state, { type: "set-reps", exerciseId: "shrugs", value: "5" })).toBe(
      state
    )
  })
})

describe("rest timer", () => {
  it("starts a countdown when a set is newly marked", () => {
    const state = toggle(createInitialState("push"), "bench-press", 0)

    expect(state.timer.status).toBe("running")
    expect(state.timer.deadline).toBe(T0 + 90_000)
    expect(remainingMs(state.timer, T0 + 10_000)).toBe(80_000)
  })

  it("restarts the countdown when the next set is marked", () => {
    let state = toggle(createInitialState("push"), "bench-press", 0)
    state = toggle(state, "bench-press", 1, T0 + 30_000)

    expect(state.timer.status).toBe("running")
    expect(state.timer.deadline).toBe(T0 + 30_000 + 90_000)
  })

  it("does not start the timer when a set is unmarked", () => {
    let state = toggle(createInitialState("push"), "bench-press", 0)
    state = workoutReducer(state, { type: "skip" })
    expect(state.timer.status).toBe("idle")

    state = toggle(state, "bench-press", 0, T0 + 1_000)
    expect(state.timer.status).toBe("idle")
  })

  it("stops the timer and completes the workout on the final set", () => {
    let state = createInitialState("push")
    // Mark 17 of 18 sets.
    for (const exercise of PUSH.exercises) {
      for (let setIndex = 0; setIndex < exercise.sets; setIndex += 1) {
        if (exercise.id === "triceps-extension" && setIndex === 2) continue
        state = toggle(state, exercise.id, setIndex)
      }
    }
    expect(countCompleted(state)).toBe(17)
    expect(state.timer.status).toBe("running")

    state = toggle(state, "triceps-extension", 2, T0 + 1_000)

    expect(isWorkoutComplete(state)).toBe(true)
    expect(state.timer.status).toBe("idle")
    expect(state.timer.deadline).toBeNull()
  })

  it("pauses by freezing the remainder and resumes from it", () => {
    let state = toggle(createInitialState("push"), "bench-press", 0)

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
    const state = createInitialState("push")
    expect(workoutReducer(state, { type: "pause", now: T0 })).toBe(state)
    expect(workoutReducer(state, { type: "resume", now: T0 })).toBe(state)
  })

  it("clears the timer on skip and keeps the chosen preset", () => {
    let state = workoutReducer(createInitialState("push"), {
      type: "select-duration",
      seconds: 120,
      now: T0,
    })
    state = toggle(state, "bench-press", 0)
    state = workoutReducer(state, { type: "skip" })

    expect(state.timer.status).toBe("idle")
    expect(state.timer.deadline).toBeNull()
    expect(state.timer.remainingMs).toBeNull()
    expect(state.timer.durationSeconds).toBe(120)
  })

  it("finishes exactly at the deadline and requests one beep", () => {
    const started = toggle(createInitialState("push"), "bench-press", 0)

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
    let state = workoutReducer(createInitialState("push"), {
      type: "set-sound",
      enabled: false,
    })
    state = toggle(state, "bench-press", 0)
    state = workoutReducer(state, { type: "tick", now: T0 + 90_000 })

    expect(state.timer.status).toBe("finished")
    expect(state.beepAt).toBeNull()
  })

  it("survives a throttled tab: one late tick still finishes the timer", () => {
    const started = toggle(createInitialState("push"), "bench-press", 0)
    const finished = workoutReducer(started, { type: "tick", now: T0 + 600_000 })

    expect(finished.timer.status).toBe("finished")
    expect(remainingMs(finished.timer, T0 + 600_000)).toBe(0)
  })
})

describe("rest presets", () => {
  it("updates the duration while idle without starting anything", () => {
    const state = workoutReducer(createInitialState("push"), {
      type: "select-duration",
      seconds: 60,
      now: T0,
    })
    expect(state.timer.status).toBe("idle")
    expect(state.timer.durationSeconds).toBe(60)
    expect(remainingMs(state.timer, T0)).toBe(60_000)
  })

  it("restarts a running countdown against the new preset", () => {
    let state = toggle(createInitialState("push"), "bench-press", 0)
    state = workoutReducer(state, { type: "select-duration", seconds: 180, now: T0 + 10_000 })

    expect(state.timer.status).toBe("running")
    expect(state.timer.durationSeconds).toBe(180)
    expect(state.timer.deadline).toBe(T0 + 10_000 + 180_000)
  })

  it("keeps a paused timer paused on the new preset", () => {
    let state = toggle(createInitialState("push"), "bench-press", 0)
    state = workoutReducer(state, { type: "pause", now: T0 + 10_000 })
    state = workoutReducer(state, { type: "select-duration", seconds: 60, now: T0 + 20_000 })

    expect(state.timer.status).toBe("paused")
    expect(state.timer.durationSeconds).toBe(60)
    expect(state.timer.remainingMs).toBe(60_000)
  })

  it("rejects durations that are not presets", () => {
    const state = createInitialState("push")
    expect(workoutReducer(state, { type: "select-duration", seconds: 45, now: T0 })).toBe(state)
  })
})

describe("selecting another workout", () => {
  it("replaces the session with fresh defaults of the chosen workout", () => {
    let state = createInitialState("pull")
    state = toggle(state, "lat-pulldown-wide", 0)
    state = workoutReducer(state, {
      type: "set-weight",
      exerciseId: "lat-pulldown-wide",
      value: "35",
    })
    state = workoutReducer(state, { type: "set-reps", exerciseId: "shrugs", value: "20" })
    state = workoutReducer(state, { type: "select-duration", seconds: 180, now: T0 })
    state = workoutReducer(state, { type: "set-sound", enabled: false })

    const switched = workoutReducer(state, { type: "select-workout", workoutId: "push" })

    expect(switched).toEqual(createInitialState("push"))
    expect(switched.workoutId).toBe("push")
    expect(countCompleted(switched)).toBe(0)
    expect(switched.timer.status).toBe("idle")
    expect(switched.timer.durationSeconds).toBe(90)
    expect(switched.soundEnabled).toBe(true)
    expect(switched.weights["bench-press"]).toBe("10–13")
    expect(switched.beepAt).toBeNull()
  })

  it("resets the chosen set count too", () => {
    let state = workoutReducer(createInitialState("push"), {
      type: "set-sets",
      exerciseId: "pec-deck",
      count: 2,
    })
    state = workoutReducer(state, { type: "select-workout", workoutId: "legs" })
    state = workoutReducer(state, { type: "select-workout", workoutId: "push" })

    expect(setsFor(state, ex(state, "pec-deck"))).toBe(3)
    expect(totalSets(state)).toBe(18)
  })

  it("starts over when switching back, keeping nothing", () => {
    let state = toggle(createInitialState("pull"), "lat-pulldown-wide", 0)
    state = workoutReducer(state, { type: "select-workout", workoutId: "push" })
    state = workoutReducer(state, { type: "select-workout", workoutId: "pull" })

    expect(state).toEqual(createInitialState("pull"))
    expect(countCompleted(state)).toBe(0)
  })

  it("leaves a pending beep behind so nothing sounds after the switch", () => {
    let state = toggle(createInitialState("pull"), "lat-pulldown-wide", 0)
    state = workoutReducer(state, { type: "tick", now: T0 + 90_000 })
    expect(state.beepAt).toBe(T0 + 90_000)

    state = workoutReducer(state, { type: "select-workout", workoutId: "push" })
    expect(state.beepAt).toBeNull()
    expect(state.timer.status).toBe("idle")
  })

  it("is a no-op for the current workout and for unknown ids", () => {
    const state = toggle(createInitialState("pull"), "lat-pulldown-wide", 0)
    expect(workoutReducer(state, { type: "select-workout", workoutId: "pull" })).toBe(state)
    expect(
      workoutReducer(state, { type: "select-workout", workoutId: "arms" as WorkoutId })
    ).toBe(state)
  })
})

describe("pristine session", () => {
  it("is pristine only on the default workout with nothing touched", () => {
    const fresh = createInitialState()
    expect(isPristine(fresh)).toBe(true)

    expect(isPristine(toggle(fresh, "lat-pulldown-wide", 0))).toBe(false)
    expect(isPristine(createInitialState("push"))).toBe(false)
    expect(
      isPristine(workoutReducer(fresh, { type: "set-weight", exerciseId: "shrugs", value: "20" }))
    ).toBe(false)
    expect(isPristine(workoutReducer(fresh, { type: "set-sound", enabled: false }))).toBe(false)
    expect(
      isPristine(workoutReducer(fresh, { type: "select-duration", seconds: 60, now: T0 }))
    ).toBe(false)
  })

  it("notices a non-default set count", () => {
    const state = workoutReducer(createInitialState("push"), {
      type: "set-sets",
      exerciseId: "pec-deck",
      count: 2,
    })
    expect(isPristine(state)).toBe(false)
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
  it("clears marks, edits, set count and timer, keeping the same workout", () => {
    let state = markAll(createInitialState("push"))
    state = workoutReducer(state, { type: "set-weight", exerciseId: "pec-deck", value: "60" })
    state = workoutReducer(state, { type: "set-sound", enabled: false })
    state = workoutReducer(state, { type: "select-duration", seconds: 180, now: T0 })
    state = workoutReducer(state, { type: "set-sets", exerciseId: "pec-deck", count: 2 })

    const reset = workoutReducer(state, { type: "reset" })

    expect(reset).toEqual(createInitialState("push"))
    expect(reset.workoutId).toBe("push")
    expect(countCompleted(reset)).toBe(0)
    expect(reset.weights["pec-deck"]).toBe("42–45")
    expect(reset.setCounts["pec-deck"]).toBe(3)
    expect(reset.soundEnabled).toBe(true)
    expect(reset.timer.durationSeconds).toBe(90)
    expect(reset.timer.status).toBe("idle")
  })
})

describe("buildResultsText", () => {
  it("reports the current workout title, live edits and real totals", () => {
    let state = createInitialState("push")
    state = toggle(state, "bench-press", 0)
    state = workoutReducer(state, {
      type: "set-weight",
      exerciseId: "bench-press",
      value: "15",
    })
    state = workoutReducer(state, { type: "set-reps", exerciseId: "bench-press", value: "6" })

    const text = buildResultsText(state)
    expect(text).toContain("День 2 — Push (грудь, плечи, трицепс)")
    expect(text).toContain("1. Жим лёжа — 3 × 6 повт., вес 15 кг — выполнено 1/3")
    expect(text).toContain("2. Жим на наклонной — 3 × 10 повт., вес не указан — выполнено 0/3")
    // Free-text reps are printed as written, without the "повт." unit.
    expect(text).toContain(
      "6. Трицепс на «бычьих яйцах» — 3 × до отказа, вес 20 кг — выполнено 0/3"
    )
    expect(text).toContain("Итого: 1 / 18 подходов (6%)")
    expect(text).toContain("Отдых между подходами: 90 с")
  })

  it("reports the selected set count rather than the planned one", () => {
    const state = workoutReducer(createInitialState("push"), {
      type: "set-sets",
      exerciseId: "pec-deck",
      count: 2,
    })

    const text = buildResultsText(state)
    expect(text).toContain("5. Бабочка — 2 × 10–12 повт., вес 42–45 кг — выполнено 0/2")
    expect(text).toContain("Итого: 0 / 17 подходов (0%)")
  })

  it("follows the current workout, not a fixed one", () => {
    const text = buildResultsText(createInitialState("legs"))

    expect(text).toContain("День 3 — Legs + пресс (ноги и пресс)")
    // A bodyweight entry is not a kilogram figure, so it is not suffixed with кг.
    expect(text).toContain("5. Пресс на наклонной скамье — 3 × 10–15 повт., вес: свой вес")
    expect(text).toContain("6. Планка или скручивания на блоке — 3 × до отказа, вес не указан")
    expect(text).toContain("Итого: 0 / 18 подходов (0%)")
    expect(text).not.toContain("Жим лёжа")
  })

  it("starts from the Pull day by default", () => {
    const text = buildResultsText(createInitialState())
    expect(text).toContain("День 1 — Pull (спина, бицепс, задние дельты)")
    expect(text).toContain("1. Тяга верхнего блока широким хватом — 4 × 8–12 повт., вес не указан — выполнено 0/4")
    expect(text).toContain("Итого: 0 / 19 подходов (0%)")
  })

  it("names every exercise of every workout exactly once", () => {
    for (const workout of [PULL, PUSH, LEGS]) {
      const text = buildResultsText(createInitialState(workout.id))
      workout.exercises.forEach((exercise, index) => {
        expect(text).toContain(`${index + 1}. ${exercise.name} —`)
      })
    }
  })
})
