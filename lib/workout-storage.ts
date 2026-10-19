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
  DEFAULT_EXERCISE_REST_SECONDS,
  getWorkout,
  isRestPreset,
  isRestSeconds,
  isWorkoutId,
  maxSets,
  type WorkoutId,
} from "./workout-plan"
import { isSavedWorkoutId, parseSavedWorkout, type SavedWorkout } from "./saved-workouts"
import {
  createInitialState,
  createRestSettings,
  freezeWorkout,
  isFiniteTimestamp,
  normalizeTimer,
  type ClockState,
  type RestKind,
  type RestSettings,
  type TimerState,
  type TimerStatus,
  type WorkoutDefinition,
  type WorkoutState,
} from "./workout-state"

export const STORAGE_KEY = "ui-workout:state"

/**
 * 3 — the current plan: three days of seven exercises, 3×12–15, no weights.
 *
 * Version 1 held the single hard-coded chest/shoulders plan with no workout id;
 * version 2 the previous three-day plan, whose saved weights and rep ranges
 * would otherwise outlive it. There are no migrations: switching workouts
 * already discards the session by design, so an older record is simply ignored
 * like any other incompatible one.
 *
 * The rest settings and the workout clock were added to version 3 rather than
 * bumping it: they are *optional* on read, so a record written before they
 * existed still restores its workout, marks, edits and running rest, and only
 * the new fields fall back to their defaults.
 */
export const SCHEMA_VERSION = 3

interface PersistedState {
  version: number
  workoutId: WorkoutId | SavedWorkout["id"]
  /** Only for saved-workout sessions; built-in records omit it (still version 3). */
  snapshot?: SavedWorkout
  completed: Record<string, boolean[]>
  weights: Record<string, string>
  reps: Record<string, string>
  setCounts: Record<string, number>
  soundEnabled: boolean
  /** Optional since the timer switch was added; absent means "enabled". */
  timerEnabled?: boolean
  /** Optional; absent means "derive from the timer's duration". */
  rest?: RestSettings
  timer: TimerState
  /** Optional; absent means "no workout had been started yet". */
  clock?: ClockState
}

const TIMER_STATUSES: readonly TimerStatus[] = ["idle", "running", "paused", "finished"]
const REST_KINDS: readonly RestKind[] = ["set", "exercise"]

import { getStorage } from "./storage-access"

export { getStorage }

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

  const { status, durationSeconds, deadline, remainingMs, kind } = value

  if (typeof status !== "string" || !TIMER_STATUSES.includes(status as TimerStatus)) {
    return null
  }
  if (!isRestSeconds(durationSeconds)) return null
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
    // Added later than the rest of the timer: an older record is a between-set
    // rest, which is the only kind that existed then.
    kind: REST_KINDS.includes(kind as RestKind) ? (kind as RestKind) : "set",
  }
}

/**
 * Rest settings, read leniently: each field falls back on its own, so a
 * half-written or older record keeps the marks it came with. With no settings
 * at all they are derived from the timer's duration, which is where a 60 or
 * 180 chosen in an earlier version becomes the custom duration.
 */
function readRestSettings(value: unknown, timerSeconds: number): RestSettings {
  const derived = createRestSettings(timerSeconds)
  if (!isPlainObject(value)) return derived

  const presetSeconds = isRestPreset(value.presetSeconds) ? value.presetSeconds : derived.presetSeconds
  const customSeconds = isRestSeconds(value.customSeconds) ? value.customSeconds : derived.customSeconds
  const exerciseSeconds = isRestSeconds(value.exerciseSeconds)
    ? value.exerciseSeconds
    : DEFAULT_EXERCISE_REST_SECONDS
  const mode =
    value.mode === "preset" || value.mode === "custom" ? value.mode : derived.mode

  return { mode, presetSeconds, customSeconds, exerciseSeconds }
}

/**
 * The workout clock, read strictly but on its own: a nonsensical pair of
 * timestamps resets the clock rather than discarding the whole session. A
 * record from before the clock existed starts no clock — inventing a start
 * would invent workout time that never happened.
 */
function readClock(value: unknown): ClockState {
  const empty: ClockState = { startedAt: null, finishedAt: null }
  if (!isPlainObject(value)) return empty

  const { startedAt, finishedAt } = value
  if (startedAt === null || startedAt === undefined) return empty
  if (!isFiniteTimestamp(startedAt)) return empty
  if (finishedAt === null || finishedAt === undefined) return { startedAt, finishedAt: null }
  if (!isFiniteTimestamp(finishedAt) || finishedAt < startedAt) return empty
  return { startedAt, finishedAt }
}

function validateStringMap(value: unknown, workout: WorkoutDefinition): Record<string, string> | null {
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
  workout: WorkoutDefinition
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
function readSetCounts(value: unknown, workout: WorkoutDefinition): Record<string, number> {
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

  // A saved-workout session carries its own validated snapshot and never
  // consults the catalog; a built-in one must not carry a snapshot at all.
  let snapshot: SavedWorkout | undefined
  let workout: WorkoutDefinition
  if (isSavedWorkoutId(parsed.workoutId)) {
    snapshot = freezeWorkout(parseSavedWorkout(parsed.snapshot))
    if (!snapshot || snapshot.id !== parsed.workoutId) return null
    workout = snapshot
  } else {
    if (!isWorkoutId(parsed.workoutId) || parsed.snapshot !== undefined) return null
    workout = getWorkout(parsed.workoutId)
  }

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
    ...(snapshot ? { snapshot } : {}),
    completed,
    weights,
    reps,
    setCounts: readSetCounts(parsed.setCounts, workout),
    soundEnabled: parsed.soundEnabled,
    // Optional fields: only the field itself falls back, never the session.
    timerEnabled: typeof parsed.timerEnabled === "boolean" ? parsed.timerEnabled : true,
    rest: readRestSettings(parsed.rest, timer.durationSeconds),
    // An expired deadline becomes "finished" with no pending beep.
    timer: normalizeTimer(timer, now),
    clock: readClock(parsed.clock),
    beepAt: null,
  }
}

/** Serialise the parts of the state worth keeping. `beepAt` is intentionally dropped. */
export function serializeState(state: WorkoutState): string {
  const persisted: PersistedState = {
    version: SCHEMA_VERSION,
    workoutId: state.workoutId,
    ...(state.snapshot ? { snapshot: state.snapshot } : {}),
    completed: state.completed,
    weights: state.weights,
    reps: state.reps,
    setCounts: state.setCounts,
    soundEnabled: state.soundEnabled,
    timerEnabled: state.timerEnabled,
    rest: state.rest,
    timer: state.timer,
    clock: state.clock,
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
