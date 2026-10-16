/**
 * Pure state model for the workout tracker.
 *
 * Everything here is a plain function of (state, action, now) so it can be unit
 * tested without a DOM, and so the UI layer only has to deal with rendering and
 * side effects (clipboard, audio, localStorage).
 *
 * The rest timer is deadline-based: a running timer stores the absolute epoch
 * milliseconds at which it ends, never a countdown counter. That keeps it
 * correct when the browser throttles timers in a background tab, and it is what
 * makes restoring a running timer after a reload straightforward.
 */

import {
  DEFAULT_REST_SECONDS,
  EXERCISES,
  REST_PRESETS,
  TOTAL_SETS,
  type Exercise,
} from "./workout-plan"

export type TimerStatus = "idle" | "running" | "paused" | "finished"

export interface TimerState {
  status: TimerStatus
  /** Currently selected rest preset, in seconds. */
  durationSeconds: number
  /** Epoch ms at which a running timer ends. Only set while `running`. */
  deadline: number | null
  /** Frozen remainder in ms. Only set while `paused`. */
  remainingMs: number | null
}

export interface WorkoutState {
  /** exercise id -> one boolean per set. */
  completed: Record<string, boolean[]>
  /** exercise id -> edited weight string. */
  weights: Record<string, string>
  /** exercise id -> edited reps string. */
  reps: Record<string, string>
  soundEnabled: boolean
  timer: TimerState
  /**
   * Timestamp of the most recent *natural* rest completion. Bumped only by the
   * `tick` action, so restoring an already-expired timer from storage never
   * replays an overdue beep. Not persisted.
   */
  beepAt: number | null
}

export type WorkoutAction =
  | { type: "toggle-set"; exerciseId: string; setIndex: number; now: number }
  | { type: "set-weight"; exerciseId: string; value: string }
  | { type: "set-reps"; exerciseId: string; value: string }
  | { type: "select-duration"; seconds: number; now: number }
  | { type: "pause"; now: number }
  | { type: "resume"; now: number }
  | { type: "skip" }
  | { type: "set-sound"; enabled: boolean }
  | { type: "tick"; now: number }
  | { type: "hydrate"; state: WorkoutState }
  | { type: "reset" }

export function createInitialTimer(
  durationSeconds: number = DEFAULT_REST_SECONDS
): TimerState {
  return {
    status: "idle",
    durationSeconds,
    deadline: null,
    remainingMs: null,
  }
}

/**
 * Deterministic starting state. Must not read the clock or any browser API so
 * that the server-rendered markup matches the client's first render.
 */
export function createInitialState(
  exercises: readonly Exercise[] = EXERCISES
): WorkoutState {
  const completed: Record<string, boolean[]> = {}
  const weights: Record<string, string> = {}
  const reps: Record<string, string> = {}

  for (const exercise of exercises) {
    completed[exercise.id] = new Array<boolean>(exercise.sets).fill(false)
    weights[exercise.id] = exercise.weight
    reps[exercise.id] = exercise.reps
  }

  return {
    completed,
    weights,
    reps,
    soundEnabled: true,
    timer: createInitialTimer(),
    beepAt: null,
  }
}

export function isRestPreset(value: unknown): value is number {
  return typeof value === "number" && (REST_PRESETS as readonly number[]).includes(value)
}

/** Number of sets marked as done across the whole workout. */
export function countCompleted(state: WorkoutState): number {
  let total = 0
  for (const marks of Object.values(state.completed)) {
    for (const done of marks) if (done) total += 1
  }
  return total
}

export function countCompletedFor(state: WorkoutState, exerciseId: string): number {
  return (state.completed[exerciseId] ?? []).filter(Boolean).length
}

/** Whole-percent progress, rounded. 0 when there is nothing to do. */
export function progressPercent(state: WorkoutState, total: number = TOTAL_SETS): number {
  if (total <= 0) return 0
  return Math.round((countCompleted(state) / total) * 100)
}

export function isWorkoutComplete(
  state: WorkoutState,
  total: number = TOTAL_SETS
): boolean {
  return total > 0 && countCompleted(state) >= total
}

/**
 * Milliseconds left on the clock for display purposes.
 * `now` is only consulted for a running timer.
 */
export function remainingMs(timer: TimerState, now: number): number {
  switch (timer.status) {
    case "running":
      return timer.deadline === null ? 0 : Math.max(0, timer.deadline - now)
    case "paused":
      return Math.max(0, timer.remainingMs ?? 0)
    case "finished":
      return 0
    case "idle":
    default:
      return timer.durationSeconds * 1000
  }
}

/** MM:SS, always two-digit, rounding part-seconds up so 1ms left reads 00:01. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

/**
 * Collapse a timer that expired while the page was closed (or while the tab was
 * throttled) into the `finished` state. Used when restoring from storage, which
 * is why it deliberately does not touch `beepAt`.
 */
export function normalizeTimer(timer: TimerState, now: number): TimerState {
  if (timer.status === "running") {
    if (timer.deadline === null) return createInitialTimer(timer.durationSeconds)
    if (now >= timer.deadline) {
      return {
        status: "finished",
        durationSeconds: timer.durationSeconds,
        deadline: null,
        remainingMs: 0,
      }
    }
  }
  return timer
}

function startTimer(timer: TimerState, now: number): TimerState {
  return {
    status: "running",
    durationSeconds: timer.durationSeconds,
    deadline: now + timer.durationSeconds * 1000,
    remainingMs: null,
  }
}

export function workoutReducer(state: WorkoutState, action: WorkoutAction): WorkoutState {
  switch (action.type) {
    case "toggle-set": {
      const marks = state.completed[action.exerciseId]
      if (!marks || action.setIndex < 0 || action.setIndex >= marks.length) return state

      const wasDone = marks[action.setIndex]
      const nextMarks = marks.slice()
      nextMarks[action.setIndex] = !wasDone

      const next: WorkoutState = {
        ...state,
        completed: { ...state.completed, [action.exerciseId]: nextMarks },
      }

      // Unmarking never touches the timer.
      if (wasDone) return next

      // The last remaining set ends the workout instead of starting another rest.
      if (isWorkoutComplete(next)) {
        return { ...next, timer: createInitialTimer(state.timer.durationSeconds) }
      }

      return { ...next, timer: startTimer(state.timer, action.now) }
    }

    case "set-weight":
      if (!(action.exerciseId in state.weights)) return state
      return {
        ...state,
        weights: { ...state.weights, [action.exerciseId]: action.value },
      }

    case "set-reps":
      if (!(action.exerciseId in state.reps)) return state
      return {
        ...state,
        reps: { ...state.reps, [action.exerciseId]: action.value },
      }

    case "select-duration": {
      if (!isRestPreset(action.seconds)) return state
      const { timer } = state

      if (timer.status === "running") {
        // Restart the countdown against the newly chosen preset.
        return {
          ...state,
          timer: {
            status: "running",
            durationSeconds: action.seconds,
            deadline: action.now + action.seconds * 1000,
            remainingMs: null,
          },
        }
      }

      if (timer.status === "paused") {
        // Stay paused, but freeze the new preset as the remainder.
        return {
          ...state,
          timer: {
            status: "paused",
            durationSeconds: action.seconds,
            deadline: null,
            remainingMs: action.seconds * 1000,
          },
        }
      }

      // idle / finished: just adopt the new duration, ready to start.
      return { ...state, timer: createInitialTimer(action.seconds) }
    }

    case "pause": {
      const { timer } = state
      if (timer.status !== "running" || timer.deadline === null) return state
      return {
        ...state,
        timer: {
          status: "paused",
          durationSeconds: timer.durationSeconds,
          deadline: null,
          remainingMs: Math.max(0, timer.deadline - action.now),
        },
      }
    }

    case "resume": {
      const { timer } = state
      if (timer.status !== "paused") return state
      return {
        ...state,
        timer: {
          status: "running",
          durationSeconds: timer.durationSeconds,
          deadline: action.now + Math.max(0, timer.remainingMs ?? 0),
          remainingMs: null,
        },
      }
    }

    case "skip": {
      if (state.timer.status === "idle") return state
      return { ...state, timer: createInitialTimer(state.timer.durationSeconds) }
    }

    case "set-sound":
      return { ...state, soundEnabled: action.enabled }

    case "tick": {
      const { timer } = state
      if (timer.status !== "running" || timer.deadline === null) return state
      if (action.now < timer.deadline) return state
      return {
        ...state,
        timer: {
          status: "finished",
          durationSeconds: timer.durationSeconds,
          deadline: null,
          remainingMs: 0,
        },
        // Only a live tick may request a beep.
        beepAt: state.soundEnabled ? action.now : state.beepAt,
      }
    }

    case "hydrate":
      return action.state

    case "reset":
      return createInitialState()

    default:
      return state
  }
}

/**
 * True when nothing worth remembering has happened yet: no marks, untouched
 * weights/reps, default sound preference and an idle timer on the default
 * preset. The UI uses this to drop the saved record instead of writing a
 * default one back out.
 */
export function isPristine(
  state: WorkoutState,
  exercises: readonly Exercise[] = EXERCISES
): boolean {
  const initial = createInitialState(exercises)
  return (
    state.soundEnabled === initial.soundEnabled &&
    state.timer.status === "idle" &&
    state.timer.durationSeconds === initial.timer.durationSeconds &&
    exercises.every(
      (exercise) =>
        state.weights[exercise.id] === exercise.weight &&
        state.reps[exercise.id] === exercise.reps &&
        (state.completed[exercise.id] ?? []).every((done) => !done)
    )
  )
}

export const TIMER_STATUS_LABELS: Record<TimerStatus, string> = {
  idle: "Готов к старту",
  running: "Идёт отдых",
  paused: "Пауза",
  finished: "Отдых завершён",
}

/**
 * Plain-text summary of the current workout, used by "Скопировать результаты".
 * Reads the live edited weights/reps rather than the plan defaults.
 */
export function buildResultsText(
  state: WorkoutState,
  exercises: readonly Exercise[] = EXERCISES
): string {
  const lines: string[] = ["Тренировка: грудь и плечи"]

  exercises.forEach((exercise, index) => {
    const marks = state.completed[exercise.id] ?? []
    const done = marks.filter(Boolean).length
    const weight = (state.weights[exercise.id] ?? "").trim()
    const reps = (state.reps[exercise.id] ?? "").trim()

    const details = [`${exercise.sets} × ${reps || "—"} повт.`]
    details.push(weight ? `вес ${weight} кг` : "вес не указан")

    lines.push(
      `${index + 1}. ${exercise.name} — ${details.join(", ")} — выполнено ${done}/${exercise.sets}`
    )
  })

  const total = exercises.reduce((sum, exercise) => sum + exercise.sets, 0)
  const completed = countCompleted(state)
  const percent = progressPercent(state, total)
  lines.push(`Итого: ${completed} / ${total} подходов (${percent}%)`)
  lines.push(`Отдых между подходами: ${state.timer.durationSeconds} с`)

  return lines.join("\n")
}
