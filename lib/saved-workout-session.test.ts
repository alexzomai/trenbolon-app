import { beforeEach, describe, expect, it } from "vitest"

import { createWorkoutRepository, draftFromWorkout, type SavedWorkout } from "./saved-workouts"
import { getWorkout } from "./workout-plan"
import {
  createInitialState,
  isPristine,
  setsFor,
  totalSets,
  workoutOf,
  workoutReducer,
} from "./workout-state"
import {
  SCHEMA_VERSION,
  STORAGE_KEY,
  loadState,
  parseState,
  saveState,
  serializeState,
} from "./workout-storage"

const T0 = 1_700_000_000_000

function savedWorkout(overrides: Partial<SavedWorkout> = {}): SavedWorkout {
  return {
    id: "user:abc",
    label: "Моя",
    title: "Моя тренировка",
    restSeconds: 120,
    soundEnabled: false,
    exercises: [
      { id: "a", name: "Присед", sets: 3, setOptions: [2, 3, 4], reps: "8", weight: "40" },
      { id: "b", name: "Тяга", sets: 2, reps: "до отказа", weight: "" },
    ],
    ...overrides,
  }
}

/** Parse a serialized record after letting `edit` tamper with it. */
function tampered(state = createInitialState(savedWorkout()), edit: (raw: Record<string, unknown>) => void) {
  const raw = JSON.parse(serializeState(state)) as Record<string, unknown>
  edit(raw)
  return parseState(JSON.stringify(raw), T0)
}

describe("saved workout sessions", () => {
  it("starts from the snapshot's defaults, including rest and sound", () => {
    const state = createInitialState(savedWorkout())
    expect(state.workoutId).toBe("user:abc")
    expect(state.timer.durationSeconds).toBe(120)
    expect(state.soundEnabled).toBe(false)
    expect(workoutOf(state).title).toBe("Моя тренировка")
    expect(totalSets(state)).toBe(5)
    expect(state.completed.a).toHaveLength(4)
    expect(state.weights.a).toBe("40")
    expect(state.setCounts).toEqual({ a: 3 })
    expect(isPristine(state)).toBe(false)
  })

  it("keeps built-in sessions without a snapshot", () => {
    const state = createInitialState("legs")
    expect(state.snapshot).toBeUndefined()
    expect(workoutOf(state)).toBe(getWorkout("legs"))
    expect(isPristine(createInitialState())).toBe(true)
  })

  it("is isolated from the source object and immutable", () => {
    const source = savedWorkout()
    const state = createInitialState(source)
    source.exercises[0].name = "Изменено"
    source.title = "Другое"
    expect(workoutOf(state).title).toBe("Моя тренировка")
    expect(workoutOf(state).exercises[0].name).toBe("Присед")
    expect(Object.isFrozen(state.snapshot)).toBe(true)
    expect(Object.isFrozen(state.snapshot!.exercises[0])).toBe(true)
  })

  it("start-saved-workout always restarts, even for the running id", () => {
    let state = createInitialState(savedWorkout())
    state = workoutReducer(state, { type: "toggle-set", exerciseId: "b", setIndex: 0, now: T0 })
    expect(state.timer.status).toBe("running")

    const newer = savedWorkout({ title: "Новая версия", restSeconds: 60 })
    const restarted = workoutReducer(state, { type: "start-saved-workout", workout: newer })
    expect(workoutOf(restarted).title).toBe("Новая версия")
    expect(restarted.timer).toMatchObject({ status: "idle", durationSeconds: 60 })
    expect(restarted.completed.b).toEqual([false, false])
  })

  it("replaces a built-in session and rejects an invalid workout", () => {
    const builtIn = createInitialState("push")
    const started = workoutReducer(builtIn, { type: "start-saved-workout", workout: savedWorkout() })
    expect(started.workoutId).toBe("user:abc")
    const bad = { ...savedWorkout(), exercises: [] } as SavedWorkout
    expect(workoutReducer(builtIn, { type: "start-saved-workout", workout: bad })).toBe(builtIn)
    const forged = { ...savedWorkout(), id: "pull" } as unknown as SavedWorkout
    expect(workoutReducer(builtIn, { type: "start-saved-workout", workout: forged })).toBe(builtIn)
  })

  it("reset restarts from the snapshot and set counts follow it", () => {
    let state = createInitialState(savedWorkout())
    state = workoutReducer(state, { type: "set-sets", exerciseId: "a", count: 4 })
    expect(setsFor(state, workoutOf(state).exercises[0])).toBe(4)
    state = workoutReducer(state, { type: "reset" })
    expect(state.workoutId).toBe("user:abc")
    expect(state.setCounts).toEqual({ a: 3 })
    expect(state.timer.durationSeconds).toBe(120)
  })

  it("select-workout moves from a saved workout to a built-in", () => {
    const state = workoutReducer(createInitialState(savedWorkout()), {
      type: "select-workout",
      workoutId: "pull",
    })
    expect(state.workoutId).toBe("pull")
    expect(state.snapshot).toBeUndefined()
  })
})

describe("saved workout session storage", () => {
  beforeEach(() => localStorage.clear())

  it("round-trips the snapshot and live progress without the catalog", () => {
    let state = createInitialState(savedWorkout())
    state = workoutReducer(state, { type: "toggle-set", exerciseId: "a", setIndex: 1, now: T0 })
    state = workoutReducer(state, { type: "set-weight", exerciseId: "a", value: "55" })
    const restored = parseState(serializeState(state), T0 + 1000)
    expect(restored).toMatchObject({ workoutId: "user:abc", snapshot: savedWorkout() })
    expect(restored?.completed.a[1]).toBe(true)
    expect(restored?.weights.a).toBe("55")
    expect(restored?.timer.status).toBe("running")
    expect(Object.isFrozen(restored?.snapshot)).toBe(true)
  })

  it("survives catalog edit and delete and reload", () => {
    const repo = createWorkoutRepository()
    const created = repo.create(draftFromWorkout(savedWorkout()))
    if (!created.ok) throw new Error(created.error)
    saveState(createInitialState(created.value))

    repo.update(created.value.id, { ...draftFromWorkout(created.value), title: "Переименована" })
    expect(loadState(T0)?.snapshot?.title).toBe("Моя тренировка")
    repo.remove(created.value.id)
    expect(loadState(T0)?.snapshot?.title).toBe("Моя тренировка")
    expect(loadState(T0)?.snapshot?.exercises).toEqual(savedWorkout().exercises)
  })

  it("stays at schema version 3 and omits the snapshot for built-ins", () => {
    const raw = JSON.parse(serializeState(createInitialState("legs")))
    expect(raw.version).toBe(SCHEMA_VERSION)
    expect(SCHEMA_VERSION).toBe(3)
    expect("snapshot" in raw).toBe(false)
    expect(parseState(JSON.stringify(raw), T0)?.workoutId).toBe("legs")
  })

  it("rejects malformed user ids, missing and mismatched snapshots", () => {
    expect(tampered(undefined, (raw) => delete raw.snapshot)).toBeNull()
    expect(tampered(undefined, (raw) => (raw.workoutId = "user:other"))).toBeNull()
    expect(tampered(undefined, (raw) => (raw.workoutId = "user:"))).toBeNull()
    expect(tampered(undefined, (raw) => (raw.workoutId = "usr:abc"))).toBeNull()
    expect(tampered(undefined, (raw) => (raw.workoutId = "toString"))).toBeNull()
  })

  it("rejects invalid snapshots", () => {
    const edit = (change: (snapshot: Record<string, any>) => void) => // eslint-disable-line @typescript-eslint/no-explicit-any
      tampered(undefined, (raw) => change(raw.snapshot as Record<string, any>)) // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(edit((s) => (s.exercises = []))).toBeNull()
    expect(edit((s) => (s.exercises[0].sets = 101))).toBeNull()
    expect(edit((s) => (s.exercises[0].setOptions = [2, 4]))).toBeNull()
    expect(edit((s) => (s.exercises[1].id = "a"))).toBeNull()
    expect(edit((s) => (s.exercises[0].id = "__proto__"))).toBeNull()
    expect(edit((s) => (s.restSeconds = 45))).toBeNull()
    expect(edit((s) => (s.title = " "))).toBeNull()
    expect(tampered(undefined, (raw) => (raw.snapshot = "nope"))).toBeNull()
  })

  it("rejects a snapshot on a built-in record", () => {
    const raw = JSON.parse(serializeState(createInitialState("pull")))
    raw.snapshot = savedWorkout()
    expect(parseState(JSON.stringify(raw), T0)).toBeNull()
  })

  it("rejects progress that does not fit the snapshot", () => {
    expect(tampered(undefined, (raw) => ((raw.completed as Record<string, boolean[]>).a = [true]))).toBeNull()
    expect(tampered(undefined, (raw) => delete (raw.weights as Record<string, string>).b)).toBeNull()
  })

  it("writes the record under the session key", () => {
    saveState(createInitialState(savedWorkout()))
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).snapshot.id).toBe("user:abc")
  })
})
