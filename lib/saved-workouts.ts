import { REST_PRESETS, type Exercise, type Workout } from "./workout-plan"
import { getStorage } from "./workout-storage"

export const SAVED_WORKOUTS_KEY = "ui-workout:workouts"
export const SAVED_WORKOUTS_VERSION = 1

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
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100
const safeId = (value: unknown): value is string =>
  text(value) && !["__proto__", "constructor", "prototype"].includes(value)

function validDraft(value: unknown): value is WorkoutDraft {
  if (!object(value) || !text(value.title) || !text(value.label)) return false
  if (typeof value.soundEnabled !== "boolean") return false
  if (!(REST_PRESETS as readonly unknown[]).includes(value.restSeconds)) return false
  if (!Array.isArray(value.exercises) || !value.exercises.length || value.exercises.length > 1000) return false
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
      if (!validDraft(workout) || !object(workout) || !text(workout.id) ||
        !workout.id.startsWith("user:") || workout.id.length <= 5 || ids.has(workout.id)) return fail("corrupt")
      ids.add(workout.id)
      workouts.push({ ...copyDraft(workout), id: workout.id as SavedWorkout["id"] })
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
    update: (id: string, draft: WorkoutDraft) => save(draft, id), remove }
}

export const savedWorkouts = createWorkoutRepository()
