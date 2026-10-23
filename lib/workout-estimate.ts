import { countCompletedFor, remainingMs, restSecondsFor, workoutOf, type WorkoutState } from "./workout-state"

/** No per-set timing history is stored: work is explicitly estimated at 45s. */
export function estimateWorkout(state: WorkoutState, now: number) {
  const counts = workoutOf(state).exercises.map(e => Math.max(0, selectedSets(state, e) - countCompletedFor(state, e)))
  const exercises = counts.filter(Boolean).length
  const sets = counts.reduce((a, b) => a + b, 0)
  if (!sets) return { remaining: 0, finish: now, sets, exercises, paused: false }
  const active = state.timerEnabled && (state.timer.status === "running" || state.timer.status === "paused")
  const rest = state.timerEnabled
    ? (sets - exercises) * restSecondsFor(state, "set") * 1000 + Math.max(0, exercises - 1) * restSecondsFor(state, "exercise") * 1000
    : 0
  const remaining = sets * 45_000 + rest + (active ? remainingMs(state.timer, now) : 0)
  return { remaining, finish: now + remaining, sets, exercises, paused: active && state.timer.status === "paused" }
}
import { setsFor as selectedSets } from "./workout-state"
