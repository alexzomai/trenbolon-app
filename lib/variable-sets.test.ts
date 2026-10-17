/**
 * The variable-set-count capability, exercised against a fixture plan.
 *
 * The current note prescribes a fixed three sets everywhere, so there is no
 * real exercise left to drive this with. The behaviour still ships — a future
 * note may well say "2–3×" again — so it is tested by standing a fixture
 * workout in for the Push day instead of asserting anything about the plan.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./workout-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./workout-plan")>()
  const FIXTURE: typeof actual.WORKOUTS.push = {
    id: "push",
    label: "Грудь",
    title: "Грудь",
    exercises: [
      { id: "fixed", name: "Упражнение с фиксированным числом", sets: 3, reps: "12–15", weight: "" },
      {
        id: "variable",
        name: "Упражнение с выбором",
        sets: 3,
        setOptions: [2, 3],
        reps: "12–15",
        weight: "",
      },
    ],
  }
  return {
    ...actual,
    WORKOUTS: { ...actual.WORKOUTS, push: FIXTURE },
    getWorkout: (id: typeof actual.DEFAULT_WORKOUT_ID) =>
      id === "push" ? FIXTURE : actual.WORKOUTS[id],
  }
})

const { getWorkout } = await import("./workout-plan")
const {
  buildResultsText,
  countCompleted,
  countCompletedFor,
  createInitialState,
  hiddenCompletedFor,
  isPristine,
  isWorkoutComplete,
  setsFor,
  totalSets,
  workoutReducer,
} = await import("./workout-state")
const { STORAGE_KEY, loadState, parseState, saveState, serializeState } = await import(
  "./workout-storage"
)

type State = ReturnType<typeof createInitialState>

const T0 = 1_700_000_000_000

const variable = () => getWorkout("push").exercises[1]

function setSets(state: State, count: number): State {
  return workoutReducer(state, { type: "set-sets", exerciseId: "variable", count })
}

function toggle(state: State, exerciseId: string, setIndex: number, now = T0): State {
  return workoutReducer(state, { type: "toggle-set", exerciseId, setIndex, now })
}

beforeEach(() => {
  window.localStorage.clear()
})

describe("choosing a set count", () => {
  it("defaults to the planned count, and only for the exercise offering a choice", () => {
    expect(createInitialState("push").setCounts).toEqual({ variable: 3 })
    expect(totalSets(createInitialState("push"))).toBe(6)
  })

  it("shrinks the total and completes the workout at the lower count", () => {
    let state = setSets(createInitialState("push"), 2)

    expect(setsFor(state, variable())).toBe(2)
    expect(totalSets(state)).toBe(5)

    for (const exercise of getWorkout("push").exercises) {
      for (let setIndex = 0; setIndex < setsFor(state, exercise); setIndex += 1) {
        state = toggle(state, exercise.id, setIndex)
      }
    }
    expect(countCompleted(state)).toBe(5)
    expect(isWorkoutComplete(state)).toBe(true)
    expect(state.timer.status).toBe("idle")
  })

  it("parks a discarded mark and brings it back deterministically", () => {
    let state = toggle(createInitialState("push"), "variable", 2)
    expect(countCompleted(state)).toBe(1)

    state = setSets(state, 2)
    expect(countCompletedFor(state, variable())).toBe(0)
    expect(hiddenCompletedFor(state, variable())).toBe(1)
    expect(state.completed["variable"]).toEqual([false, false, true])

    state = setSets(state, 3)
    expect(countCompleted(state)).toBe(1)
    expect(hiddenCompletedFor(state, variable())).toBe(0)
  })

  it("refuses to mark a set beyond the chosen count", () => {
    const state = setSets(createInitialState("push"), 2)
    expect(toggle(state, "variable", 2)).toBe(state)
  })

  it("ignores counts the plan does not offer, and exercises with no choice", () => {
    const state = createInitialState("push")
    expect(setSets(state, 4)).toBe(state)
    expect(setSets(state, 0)).toBe(state)
    expect(setSets(state, 3)).toBe(state)
    expect(
      workoutReducer(state, { type: "set-sets", exerciseId: "fixed", count: 2 })
    ).toBe(state)
  })

  it("is not a pristine session, and reset restores the default count", () => {
    const state = setSets(createInitialState("push"), 2)
    expect(isPristine(state)).toBe(false)
    expect(workoutReducer(state, { type: "reset" }).setCounts["variable"]).toBe(3)
  })

  it("is reported by the results text instead of the planned count", () => {
    const text = buildResultsText(setSets(createInitialState("push"), 2))
    expect(text).toContain("2. Упражнение с выбором — 2 × 12–15 повт., вес не указан — выполнено 0/2")
    expect(text).toContain("Итого: 0 / 5 подходов (0%)")
  })
})

describe("persisting the chosen set count", () => {
  it("survives a save/load roundtrip, and with it the real total", () => {
    saveState(setSets(createInitialState("push"), 2))

    const restored = loadState(T0)!
    expect(setsFor(restored, variable())).toBe(2)
    expect(totalSets(restored)).toBe(5)
  })

  it.each([
    ["missing", undefined],
    ["not an object", 3],
    ["a count the plan does not offer", { variable: 5 }],
    ["a non-numeric count", { variable: "2" }],
  ])("keeps the progress and defaults the count when setCounts is %s", (_label, setCounts) => {
    const state = toggle(createInitialState("push"), "fixed", 0)
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...JSON.parse(serializeState(state)), setCounts })
    )

    const restored = parseState(window.localStorage.getItem(STORAGE_KEY), T0)
    expect(restored).not.toBeNull()
    expect(countCompleted(restored!)).toBe(1)
    expect(restored!.setCounts).toEqual({ variable: 3 })
    expect(totalSets(restored!)).toBe(6)
  })
})
