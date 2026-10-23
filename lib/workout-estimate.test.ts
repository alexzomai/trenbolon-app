import { describe, expect, it } from "vitest"
import { createInitialState, workoutOf, workoutReducer } from "./workout-state"
import { estimateWorkout } from "./workout-estimate"

describe("workout estimate", () => {
  it("counts future rests without a rest after the last set", () => {
    const s = createInitialState()
    const e = estimateWorkout(s, 1000)
    expect(e.sets).toBe(21)
    expect(e.exercises).toBe(7)
    expect(e.remaining).toBe(21 * 45000 + 14 * 90000 + 6 * 180000)
  })
  it("uses the live rest remainder once and updates settings", () => {
    let s = createInitialState()
    s = workoutReducer(s, { type: "toggle-set", exerciseId: workoutOf(s).exercises[0].id, setIndex: 0, now: 1000 })
    const a = estimateWorkout(s, 1000)
    expect(estimateWorkout(s, 11000).remaining).toBe(a.remaining - 10000)
    expect(estimateWorkout(s, 11000).finish).toBe(a.finish)
    s = { ...s, rest: { ...s.rest, exerciseSeconds: 200 } }
    expect(estimateWorkout(s, 1000).remaining).toBe(a.remaining + 6 * 20000)
  })
  it("ignores all rests when disabled and reflects undo", () => {
    const s = { ...createInitialState(), timerEnabled: false }
    expect(estimateWorkout(s, 0).remaining).toBe(21 * 45000)
    const action = { type: "toggle-set" as const, exerciseId: workoutOf(s).exercises[0].id, setIndex: 0, now: 1000 }
    const next = workoutReducer(s, action)
    expect(estimateWorkout(next, 1000).sets).toBe(20)
    expect(estimateWorkout(workoutReducer(next, action), 1000).sets).toBe(21)
  })
  it("handles completion and paused countdown", () => {
    const s = createInitialState()
    s.timer = { ...s.timer, status: "paused", remainingMs: 30000 }
    expect(estimateWorkout(s, 0).paused).toBe(true)
    for (const marks of Object.values(s.completed)) marks.fill(true)
    expect(estimateWorkout(s, 1000).remaining).toBe(0)
  })
})
