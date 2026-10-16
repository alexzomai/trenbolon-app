/**
 * localStorage persistence for the workout tracker.
 *
 * Exactly one session is stored: the selected workout plus its marked sets,
 * edited weights/reps, chosen set counts, rest preset, sound preference and
 * live timer, in a single versioned record. There is no server, no cookie and
 * no other storage backend, and no history of other workouts — switching
 * workout starts over, so there is nothing else to keep.
 *
 * Reads are defensive on purpose: storage may be unavailable (Safari private
 * mode, disabled site data), the value may be truncated JSON, or it may come
 * from an older/newer schema. Any of those simply falls back to a fresh state.
 */

import {
  REST_PRESETS,
  getWorkout,
  isWorkoutId,
  maxSets,
  type Workout,
  type WorkoutId,
} from "./workout-plan"
import {
  createInitialState,
  normalizeTimer,
  type TimerState,
  type TimerStatus,
  type WorkoutState,
} from "./workout-state"

export const STORAGE_KEY = "ui-workout:state"

/**
 * 2 — one selected workout out of three.
 *
 * Version 1 held the single hard-coded chest/shoulders plan with no workout id.
 * Switching workouts now discards the session by design, so a v1 record is
 * simply ignored like any other incompatible one rather than migrated.
 */
export const SCHEMA_VERSION = 2

interface PersistedState {
  version: number
  workoutId: WorkoutId
  completed: Record<string, boolean[]>
  weights: Record<string, string>
  reps: Record<string, string>
  setCounts: Record<string, number>
  soundEnabled: boolean
  timer: TimerState
}

const TIMER_STATUSES: readonly TimerStatus[] = ["idle", "running", "paused", "finished"]

/**
 * Returns the Storage object, or null when it cannot be touched at all.
 * Accessing `window.localStorage` itself can throw when site data is blocked,
 * hence the try/catch around the property read.
 */
export function getStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null
    return window.localStorage ?? null
  } catch {
    return null
  }
}

/* -------------------------------------------------------------------------
 * Storage health, modelled as an external store.
 *
 * Whether writes actually work can only be learned by attempting one, which
 * happens inside an effect. Rather than calling setState from that effect — a
 * cascading render, and what `react-hooks/set-state-in-effect` rightly rejects
 * — a failed write flips a module-level flag and notifies subscribers. The UI
 * reads it through `useSyncExternalStore`, which is the supported way to
 * surface external state, and is hydration-safe via its server snapshot.
 * ---------------------------------------------------------------------- */

let storageHealthy = true
const healthListeners = new Set<() => void>()

function markStorageUnhealthy(): void {
  if (!storageHealthy) return
  storageHealthy = false
  for (const listener of healthListeners) listener()
}

export function subscribeStorageHealth(onStoreChange: () => void): () => void {
  healthListeners.add(onStoreChange)
  return () => {
    healthListeners.delete(onStoreChange)
  }
}

export function getStorageHealthSnapshot(): boolean {
  return storageHealthy
}

/**
 * Optimistic on the server: the prerendered HTML must not warn about storage
 * the server knows nothing about.
 */
export function getServerStorageHealthSnapshot(): boolean {
  return true
}

/** Test seam: forget a previously observed failure. */
export function resetStorageHealthForTests(): void {
  if (storageHealthy) return
  storageHealthy = true
  for (const listener of healthListeners) listener()
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function validateTimer(value: unknown): TimerState | null {
  if (!isPlainObject(value)) return null

  const { status, durationSeconds, deadline, remainingMs } = value

  if (typeof status !== "string" || !TIMER_STATUSES.includes(status as TimerStatus)) {
    return null
  }
  if (!isFiniteNumber(durationSeconds)) return null
  if (!(REST_PRESETS as readonly number[]).includes(durationSeconds)) return null
  if (deadline !== null && !isFiniteNumber(deadline)) return null
  if (remainingMs !== null && !isFiniteNumber(remainingMs)) return null

  // A running timer is meaningless without its deadline, and a paused one
  // without its frozen remainder; treat either as corrupt.
  if (status === "running" && !isFiniteNumber(deadline)) return null
  if (status === "paused" && !isFiniteNumber(remainingMs)) return null

  return {
    status: status as TimerStatus,
    durationSeconds,
    deadline: isFiniteNumber(deadline) ? deadline : null,
    remainingMs: isFiniteNumber(remainingMs) ? Math.max(0, remainingMs) : null,
  }
}

function validateStringMap(value: unknown, workout: Workout): Record<string, string> | null {
  if (!isPlainObject(value)) return null
  const result: Record<string, string> = {}
  for (const exercise of workout.exercises) {
    const entry = value[exercise.id]
    if (typeof entry !== "string") return null
    result[exercise.id] = entry
  }
  return result
}

function validateCompleted(
  value: unknown,
  workout: Workout
): Record<string, boolean[]> | null {
  if (!isPlainObject(value)) return null
  const result: Record<string, boolean[]> = {}
  for (const exercise of workout.exercises) {
    const marks = value[exercise.id]
    // Length mismatch means the plan changed under the saved data.
    if (!Array.isArray(marks) || marks.length !== maxSets(exercise)) return null
    if (!marks.every((mark) => typeof mark === "boolean")) return null
    result[exercise.id] = marks.slice()
  }
  return result
}

/**
 * Chosen set counts, read leniently: an unknown or out-of-range entry falls
 * back to the plan's default for that exercise instead of discarding the whole
 * record, since the marks are worth far more than the preference.
 */
function readSetCounts(value: unknown, workout: Workout): Record<string, number> {
  const raw = isPlainObject(value) ? value : {}
  const result: Record<string, number> = {}
  for (const exercise of workout.exercises) {
    if (!exercise.setOptions) continue
    const entry = raw[exercise.id]
    result[exercise.id] =
      isFiniteNumber(entry) && exercise.setOptions.includes(entry) ? entry : exercise.sets
  }
  return result
}

/**
 * Parse a raw localStorage string into a usable state, or null if it is absent,
 * malformed or from an incompatible schema version.
 *
 * `now` is used to collapse a timer that expired while the page was closed.
 */
export function parseState(raw: string | null, now: number): WorkoutState | null {
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isPlainObject(parsed)) return null
  if (parsed.version !== SCHEMA_VERSION) return null
  if (!isWorkoutId(parsed.workoutId)) return null

  const workout = getWorkout(parsed.workoutId)

  const completed = validateCompleted(parsed.completed, workout)
  if (!completed) return null

  const weights = validateStringMap(parsed.weights, workout)
  if (!weights) return null

  const reps = validateStringMap(parsed.reps, workout)
  if (!reps) return null

  if (typeof parsed.soundEnabled !== "boolean") return null

  const timer = validateTimer(parsed.timer)
  if (!timer) return null

  return {
    workoutId: workout.id,
    completed,
    weights,
    reps,
    setCounts: readSetCounts(parsed.setCounts, workout),
    soundEnabled: parsed.soundEnabled,
    // An expired deadline becomes "finished" with no pending beep.
    timer: normalizeTimer(timer, now),
    beepAt: null,
  }
}

/** Serialise the parts of the state worth keeping. `beepAt` is intentionally dropped. */
export function serializeState(state: WorkoutState): string {
  const persisted: PersistedState = {
    version: SCHEMA_VERSION,
    workoutId: state.workoutId,
    completed: state.completed,
    weights: state.weights,
    reps: state.reps,
    setCounts: state.setCounts,
    soundEnabled: state.soundEnabled,
    timer: state.timer,
  }
  return JSON.stringify(persisted)
}

/**
 * Read and validate the saved state. Never throws.
 *
 * Deliberately does not touch the health flag: this runs inside a reducer
 * initializer, i.e. during render, where notifying subscribers would mean
 * updating other components mid-render. A broken storage is reported by the
 * first write instead, which always happens from an effect.
 */
export function loadState(now: number): WorkoutState | null {
  const storage = getStorage()
  if (!storage) return null
  try {
    return parseState(storage.getItem(STORAGE_KEY), now)
  } catch {
    return null
  }
}

/**
 * Write the state. Returns false — and flips the health flag the UI subscribes
 * to — when storage is unavailable or full.
 */
export function saveState(state: WorkoutState): boolean {
  const storage = getStorage()
  if (!storage) {
    markStorageUnhealthy()
    return false
  }
  try {
    storage.setItem(STORAGE_KEY, serializeState(state))
    return true
  } catch {
    markStorageUnhealthy()
    return false
  }
}

/** Drop the saved record entirely, e.g. on "Начать заново". */
export function clearState(): boolean {
  const storage = getStorage()
  if (!storage) {
    markStorageUnhealthy()
    return false
  }
  try {
    storage.removeItem(STORAGE_KEY)
    return true
  } catch {
    markStorageUnhealthy()
    return false
  }
}

/** Saved state when it is usable, otherwise a fresh default workout. */
export function loadOrCreateState(now: number): WorkoutState {
  return loadState(now) ?? createInitialState()
}
