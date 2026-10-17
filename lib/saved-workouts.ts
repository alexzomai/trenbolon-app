import { REST_PRESETS, type Exercise, type Workout } from "./workout-plan"
import { getStorage } from "./storage-access"

export const SAVED_WORKOUTS_KEY = "ui-workout:workouts"
export const SAVED_WORKOUTS_VERSION = 1
export const MAX_SETS = 100
export const MAX_EXERCISES_PER_WORKOUT = 1000

/** Definitions only. Live progress/timer state belongs to workout-storage. */
export interface WorkoutDraft {
  label: string
  title: string
  exercises: readonly Exercise[]
  restSeconds: number
  soundEnabled: boolean
}

export interface SavedWorkout extends WorkoutDraft {
  /** Separate namespace: cannot overwrite a built-in workout. */
  id: `user:${string}`
}

export type WorkoutStorageError =
  | "unavailable" | "quota" | "corrupt" | "unsupported-version"
  | "invalid" | "not-found" | "write-failed"

export type StorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: WorkoutStorageError }

type CatalogStorage = Pick<Storage, "getItem" | "setItem">
const fail = (error: WorkoutStorageError): StorageResult<never> => ({ ok: false, error })
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0
const sets = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_SETS
const safeId = (value: unknown): value is string =>
  text(value) && !["__proto__", "constructor", "prototype"].includes(value)

function validDraft(value: unknown): value is WorkoutDraft {
  if (!object(value) || !text(value.title) || !text(value.label)) return false
  if (typeof value.soundEnabled !== "boolean") return false
  if (!(REST_PRESETS as readonly unknown[]).includes(value.restSeconds)) return false
  if (!Array.isArray(value.exercises) || !value.exercises.length || value.exercises.length > MAX_EXERCISES_PER_WORKOUT) return false
  const ids = new Set<string>()
  for (const exercise of value.exercises) {
    if (!object(exercise) || !safeId(exercise.id) || ids.has(exercise.id)) return false
    if (!text(exercise.name) || !sets(exercise.sets) || !text(exercise.reps)) return false
    if (typeof exercise.weight !== "string") return false
    if (exercise.setOptions !== undefined) {
      if (!Array.isArray(exercise.setOptions) || !exercise.setOptions.length) return false
      if (!exercise.setOptions.every(sets) || !exercise.setOptions.includes(exercise.sets)) return false
      if (new Set(exercise.setOptions).size !== exercise.setOptions.length) return false
    }
    ids.add(exercise.id)
  }
  return true
}

/** Copy only supported data and never retain references to a template/draft. */
function copyDraft(value: WorkoutDraft): WorkoutDraft {
  return {
    label: value.label,
    title: value.title,
    exercises: value.exercises.map((exercise) => ({
      id: exercise.id, name: exercise.name, sets: exercise.sets,
      reps: exercise.reps, weight: exercise.weight,
      ...(exercise.setOptions ? { setOptions: [...exercise.setOptions] } : {}),
    })),
    restSeconds: value.restSeconds,
    soundEnabled: value.soundEnabled,
  }
}

export function isSavedWorkoutId(value: unknown): value is SavedWorkout["id"] {
  return typeof value === "string" && value.startsWith("user:") && value.length > 5
}

/**
 * Pure snapshot validator: no storage access, no catalog lookup. Returns a deep
 * copy of a well-formed saved workout (user-namespaced id, valid draft) or null.
 * Shared by the catalog reader and by session persistence/reducer.
 */
export function parseSavedWorkout(value: unknown): SavedWorkout | null {
  if (!validDraft(value) || !object(value) || !isSavedWorkoutId(value.id)) return null
  return { ...copyDraft(value), id: value.id }
}

export function draftFromWorkout(
  workout: Workout | SavedWorkout,
  restSeconds = "restSeconds" in workout ? workout.restSeconds : 90,
  soundEnabled = "soundEnabled" in workout ? workout.soundEnabled : true,
): WorkoutDraft {
  return copyDraft({ ...workout, restSeconds, soundEnabled })
}

/** No browser access until a method is called, safe to import during SSR. */
export function createWorkoutRepository(
  storageProvider: () => CatalogStorage | null = getStorage,
  newId: () => string = () => globalThis.crypto.randomUUID(),
) {
  function storage(): CatalogStorage | null {
    try { return storageProvider() } catch { return null }
  }

  function read(target: CatalogStorage): StorageResult<SavedWorkout[]> {
    let raw: string | null
    try { raw = target.getItem(SAVED_WORKOUTS_KEY) } catch { return fail("unavailable") }
    if (raw === null) return { ok: true, value: [] }
    let data: unknown
    try { data = JSON.parse(raw) } catch { return fail("corrupt") }
    if (!object(data) || typeof data.version !== "number") return fail("corrupt")
    if (data.version !== SAVED_WORKOUTS_VERSION) return fail("unsupported-version")
    if (!Array.isArray(data.workouts)) return fail("corrupt")
    const ids = new Set<string>()
    const workouts: SavedWorkout[] = []
    for (const workout of data.workouts) {
      const parsed = parseSavedWorkout(workout)
      if (!parsed || ids.has(parsed.id)) return fail("corrupt")
      ids.add(parsed.id)
      workouts.push(parsed)
    }
    return { ok: true, value: workouts }
  }

  function write(target: CatalogStorage, workouts: SavedWorkout[]): StorageResult<SavedWorkout[]> {
    try {
      target.setItem(SAVED_WORKOUTS_KEY, JSON.stringify({ version: SAVED_WORKOUTS_VERSION, workouts }))
      return { ok: true, value: workouts }
    } catch (error) {
      return fail(object(error) && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")
        ? "quota" : "write-failed")
    }
  }

  function list(): StorageResult<SavedWorkout[]> {
    const target = storage()
    return target ? read(target) : fail("unavailable")
  }

  function get(id: string): StorageResult<SavedWorkout> {
    const result = list()
    if (!result.ok) return result
    const value = result.value.find((workout) => workout.id === id)
    return value ? { ok: true, value } : fail("not-found")
  }

  function save(draft: WorkoutDraft, id?: string): StorageResult<SavedWorkout> {
    if (!validDraft(draft)) return fail("invalid")
    const target = storage()
    if (!target) return fail("unavailable")
    const result = read(target)
    if (!result.ok) return result // Never overwrite corrupt/unknown data with an empty catalog.
    const index = id === undefined ? -1 : result.value.findIndex((workout) => workout.id === id)
    if (id !== undefined && index < 0) return fail("not-found")
    let savedId: SavedWorkout["id"]
    if (id !== undefined) savedId = result.value[index].id
    else {
      let token: string
      try { token = newId() } catch { return fail("unavailable") }
      if (!text(token)) return fail("invalid")
      savedId = `user:${token}`
      if (result.value.some((workout) => workout.id === savedId)) return fail("invalid")
    }
    const value = { ...copyDraft(draft), id: savedId }
    if (index < 0) result.value.push(value)
    else result.value[index] = value
    const written = write(target, result.value)
    return written.ok ? { ok: true, value } : written
  }

  /**
   * Appends every draft as a new workout with a fresh ID, in one write.
   * All-or-nothing: any invalid draft, unreadable catalog or failed write leaves
   * the stored catalog untouched. Existing workouts are never modified.
   */
  function importDrafts(drafts: readonly WorkoutDraft[]): StorageResult<SavedWorkout[]> {
    if (!drafts.length || !drafts.every(validDraft)) return fail("invalid")
    const target = storage()
    if (!target) return fail("unavailable")
    const result = read(target)
    if (!result.ok) return result
    const taken = new Set(result.value.map((workout) => workout.id))
    const added: SavedWorkout[] = []
    for (const draft of drafts) {
      let token: string
      try { token = newId() } catch { return fail("unavailable") }
      if (!text(token)) return fail("invalid")
      const id: SavedWorkout["id"] = `user:${token}`
      if (taken.has(id)) return fail("invalid")
      taken.add(id)
      added.push({ ...copyDraft(draft), id })
    }
    const written = write(target, [...result.value, ...added])
    return written.ok ? { ok: true, value: added } : written
  }

  function remove(id: string): StorageResult<null> {
    const target = storage()
    if (!target) return fail("unavailable")
    const result = read(target)
    if (!result.ok) return result
    if (!result.value.some((workout) => workout.id === id)) return fail("not-found")
    const written = write(target, result.value.filter((workout) => workout.id !== id))
    return written.ok ? { ok: true, value: null } : written
  }

  return { list, get, create: (draft: WorkoutDraft) => save(draft),
    update: (id: string, draft: WorkoutDraft) => save(draft, id), remove, importDrafts }
}

export const savedWorkouts = createWorkoutRepository()
