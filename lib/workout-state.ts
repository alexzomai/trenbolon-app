/**
 * Pure state model for the workout tracker.
 *
 * Everything here is a plain function of (state, action, now) so it can be unit
 * tested without a DOM, and so the UI layer only has to deal with rendering and
 * side effects (clipboard, audio, localStorage).
 *
 * There is exactly **one** session at a time. The state carries the id of the
 * workout it belongs to, so every selector can look the plan up itself. Picking
 * another workout does not merge or keep anything: it starts that workout from
 * its defaults, which is why the UI asks for confirmation first.
 *
 * The rest timer is deadline-based: a running timer stores the absolute epoch
 * milliseconds at which it ends, never a countdown counter. That keeps it
 * correct when the browser throttles timers in a background tab, and it is what
 * makes restoring a running timer after a reload straightforward.
 */

import {
  DEFAULT_REST_SECONDS,
  DEFAULT_WORKOUT_ID,
  REST_PRESETS,
  getWorkout,
  isWorkoutId,
  maxSets,
  type Exercise,
  type Workout,
  type WorkoutId,
} from "./workout-plan"
import { parseSavedWorkout, type SavedWorkout } from "./saved-workouts"

/** Anything the session can run: a built-in plan or a saved user workout. */
export type WorkoutDefinition = Workout | SavedWorkout

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
  /** Which workout this session is: a built-in id or a saved workout's id. */
  workoutId: WorkoutId | SavedWorkout["id"]
  /**
   * Immutable copy of the saved workout this session started from. Absent for
   * built-ins. The session never re-reads the catalog, so editing or deleting
   * the saved definition cannot change a running workout.
   */
  snapshot?: SavedWorkout
  /** exercise id -> one boolean per set slot (`maxSets`). */
  completed: Record<string, boolean[]>
  /** exercise id -> edited weight string. */
  weights: Record<string, string>
  /** exercise id -> edited reps string. */
  reps: Record<string, string>
  /** exercise id -> chosen set count. Only for exercises offering a choice. */
  setCounts: Record<string, number>
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
  | { type: "select-workout"; workoutId: WorkoutId }
  | { type: "start-saved-workout"; workout: SavedWorkout }
  | { type: "toggle-set"; exerciseId: string; setIndex: number; now: number }
  | { type: "set-weight"; exerciseId: string; value: string }
  | { type: "set-reps"; exerciseId: string; value: string }
  | { type: "set-sets"; exerciseId: string; count: number }
  | { type: "select-duration"; seconds: number; now: number }
  | { type: "pause"; now: number }
  | { type: "resume"; now: number }
  | { type: "skip" }
  | { type: "set-sound"; enabled: boolean }
  | { type: "tick"; now: number }
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
 * Deterministic starting state for one workout. Must not read the clock or any
 * browser API so that the server-rendered markup matches the client's first
 * render.
 */
export function createInitialState(
  source: WorkoutId | SavedWorkout = DEFAULT_WORKOUT_ID
): WorkoutState {
  // A saved workout is copied (and re-validated) so the session owns its data.
  const snapshot = typeof source === "string" ? undefined : freezeWorkout(parseSavedWorkout(source))
  if (typeof source !== "string" && !snapshot) return createInitialState()
  const definition: WorkoutDefinition = snapshot ?? getWorkout(source as WorkoutId)
  const workoutId = snapshot ? snapshot.id : (source as WorkoutId)

  const completed: Record<string, boolean[]> = {}
  const weights: Record<string, string> = {}
  const reps: Record<string, string> = {}
  const setCounts: Record<string, number> = {}

  for (const exercise of definition.exercises) {
    completed[exercise.id] = new Array<boolean>(maxSets(exercise)).fill(false)
    weights[exercise.id] = exercise.weight
    reps[exercise.id] = exercise.reps
    if (exercise.setOptions) setCounts[exercise.id] = exercise.sets
  }

  return {
    workoutId,
    ...(snapshot ? { snapshot } : {}),
    completed,
    weights,
    reps,
    setCounts,
    soundEnabled: snapshot ? snapshot.soundEnabled : true,
    timer: createInitialTimer(snapshot ? snapshot.restSeconds : DEFAULT_REST_SECONDS),
    beepAt: null,
  }
}

/** Deep-freezes a validated copy so nothing can mutate a running snapshot. */
export function freezeWorkout(workout: SavedWorkout | null): SavedWorkout | undefined {
  if (!workout) return undefined
  for (const exercise of workout.exercises) {
    if (exercise.setOptions) Object.freeze(exercise.setOptions)
    Object.freeze(exercise)
  }
  Object.freeze(workout.exercises)
  return Object.freeze(workout)
}

/** The plan the session is running: its snapshot, else the built-in. */
export function workoutOf(state: WorkoutState): WorkoutDefinition {
  if (state.snapshot) return state.snapshot
  return getWorkout(state.workoutId as WorkoutId)
}

/** The definition a reset/restart of this session starts from. */
function sourceOf(state: WorkoutState): WorkoutId | SavedWorkout {
  return state.snapshot ?? (state.workoutId as WorkoutId)
}

export function isRestPreset(value: unknown): value is number {
  return typeof value === "number" && (REST_PRESETS as readonly number[]).includes(value)
}

/** How many sets of this exercise count right now. */
export function setsFor(state: WorkoutState, exercise: Exercise): number {
  const chosen = state.setCounts[exercise.id]
  if (exercise.setOptions?.includes(chosen)) return chosen
  return exercise.sets
}

/** Number of sets marked as done, ignoring marks beyond the chosen count. */
export function countCompleted(state: WorkoutState): number {
  let total = 0
  for (const exercise of workoutOf(state).exercises) {
    total += countCompletedFor(state, exercise)
  }
  return total
}

export function countCompletedFor(state: WorkoutState, exercise: Exercise): number {
  const marks = state.completed[exercise.id] ?? []
  return marks.slice(0, setsFor(state, exercise)).filter(Boolean).length
}

/**
 * Marks kept beyond the chosen set count. Lowering the count parks them instead
 * of deleting them, so raising it again brings them back; the UI says so.
 */
export function hiddenCompletedFor(state: WorkoutState, exercise: Exercise): number {
  const marks = state.completed[exercise.id] ?? []
  return marks.slice(setsFor(state, exercise)).filter(Boolean).length
}

/** Sets to do in this session, honouring the chosen set counts. */
export function totalSets(state: WorkoutState): number {
  return workoutOf(state).exercises.reduce(
    (total, exercise) => total + setsFor(state, exercise),
    0
  )
}

/** Whole-percent progress, rounded. 0 when there is nothing to do. */
export function progressPercent(state: WorkoutState): number {
  const total = totalSets(state)
  if (total <= 0) return 0
  return Math.round((countCompleted(state) / total) * 100)
}

export function isWorkoutComplete(state: WorkoutState): boolean {
  const total = totalSets(state)
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

function findExercise(state: WorkoutState, exerciseId: string): Exercise | undefined {
  return workoutOf(state).exercises.find((exercise) => exercise.id === exerciseId)
}

export function workoutReducer(state: WorkoutState, action: WorkoutAction): WorkoutState {
  switch (action.type) {
    case "select-workout": {
      // Picking another workout starts it from scratch — no progress, no timer
      // and no settings are carried over. The UI confirms before dispatching.
      if (!isWorkoutId(action.workoutId)) return state
      if (action.workoutId === state.workoutId) return state
      return createInitialState(action.workoutId)
    }

    case "start-saved-workout": {
      // Always starts over, even for the id already running: the caller passes
      // the newest catalog version after the user confirmed the restart.
      if (!parseSavedWorkout(action.workout)) return state
      return createInitialState(action.workout)
    }

    case "toggle-set": {
      const exercise = findExercise(state, action.exerciseId)
      const marks = exercise && state.completed[action.exerciseId]
      if (!exercise || !marks) return state
      // Sets beyond the chosen count are not part of this session.
      if (action.setIndex < 0 || action.setIndex >= setsFor(state, exercise)) return state

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

    case "set-sets": {
      const exercise = findExercise(state, action.exerciseId)
      if (!exercise?.setOptions?.includes(action.count)) return state
      if (setsFor(state, exercise) === action.count) return state
      return {
        ...state,
        setCounts: { ...state.setCounts, [action.exerciseId]: action.count },
      }
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
        beepAt: state.soundEnabled && action.now - timer.deadline <= 2000
          ? timer.deadline : state.beepAt,
      }
    }

    case "reset":
      return createInitialState(sourceOf(state))

    default:
      return state
  }
}

/**
 * True when nothing worth remembering has happened yet: the default workout, no
 * marks, untouched weights/reps/set counts, default sound preference and an idle
 * timer on the default preset. The UI uses this to drop the saved record instead
 * of writing a default one back out.
 */
export function isPristine(state: WorkoutState): boolean {
  const initial = createInitialState(sourceOf(state))
  return (
    state.workoutId === DEFAULT_WORKOUT_ID &&
    state.soundEnabled === initial.soundEnabled &&
    state.timer.status === "idle" &&
    state.timer.durationSeconds === initial.timer.durationSeconds &&
    workoutOf(state).exercises.every(
      (exercise) =>
        state.weights[exercise.id] === exercise.weight &&
        state.reps[exercise.id] === exercise.reps &&
        setsFor(state, exercise) === exercise.sets &&
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

/** A weight or reps entry that is a plain figure rather than free text. */
const NUMERIC_ENTRY = /^[\d\s.,–—-]+$/

/**
 * Plain-text summary of the current session, used by "Скопировать результаты".
 * Reads the live workout, edited weights/reps and chosen set counts rather than
 * the plan defaults.
 */
export function buildResultsText(state: WorkoutState): string {
  const workout = workoutOf(state)
  const lines: string[] = [workout.title]

  workout.exercises.forEach((exercise, index) => {
    const sets = setsFor(state, exercise)
    const done = countCompletedFor(state, exercise)
    const weight = (state.weights[exercise.id] ?? "").trim()
    const reps = (state.reps[exercise.id] ?? "").trim()

    // Free text ("до отказа", "свой вес") must not be given a unit.
    const details = [
      reps
        ? NUMERIC_ENTRY.test(reps)
          ? `${sets} × ${reps} повт.`
          : `${sets} × ${reps}`
        : `${sets} × — повт.`,
    ]
    details.push(
      weight
        ? NUMERIC_ENTRY.test(weight)
          ? `вес ${weight} кг`
          : `вес: ${weight}`
        : "вес не указан"
    )

    lines.push(
      `${index + 1}. ${exercise.name} — ${details.join(", ")} — выполнено ${done}/${sets}`
    )
  })

  const completed = countCompleted(state)
  lines.push(`Итого: ${completed} / ${totalSets(state)} подходов (${progressPercent(state)}%)`)
  lines.push(`Отдых между подходами: ${state.timer.durationSeconds} с`)

  return lines.join("\n")
}
