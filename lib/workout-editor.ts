/**
 * Form model for the saved-workout editor. Pure: no React, no storage.
 *
 * The editor works on strings (what the inputs hold) and only converts to a
 * `WorkoutDraft` once validation passes, so a half-typed "1e" or "" never
 * becomes a number by accident. Exercise ids are generated once per exercise
 * and travel with it through reordering and saving.
 */

import {
  draftFromWorkout,
  type SavedWorkout,
  type StorageResult,
  type WorkoutDraft,
  type WorkoutStorageError,
} from "./saved-workouts"
import { REST_PRESETS, type Workout } from "./workout-plan"

export interface ExerciseForm {
  id: string
  name: string
  sets: string
  /** Comma-separated set counts the user may choose from; empty = no choice. */
  setOptions: string
  reps: string
  weight: string
}

export interface WorkoutForm {
  label: string
  title: string
  exercises: ExerciseForm[]
  restSeconds: number
  soundEnabled: boolean
}

export interface ExerciseErrors {
  name?: string
  sets?: string
  setOptions?: string
  reps?: string
}

export interface FormErrors {
  label?: string
  title?: string
  exercises?: string
  items: Record<string, ExerciseErrors>
}

export const MAX_EXERCISES = 100

export function newExerciseId(): string {
  return `ex-${globalThis.crypto.randomUUID()}`
}

export function blankExercise(): ExerciseForm {
  return { id: newExerciseId(), name: "", sets: "3", setOptions: "", reps: "", weight: "" }
}

export function blankForm(): WorkoutForm {
  return { label: "", title: "", exercises: [blankExercise()], restSeconds: 90, soundEnabled: true }
}

/** Form for editing: keeps the stored exercise ids. */
export function formFromDraft(draft: WorkoutDraft): WorkoutForm {
  return {
    label: draft.label,
    title: draft.title,
    exercises: draft.exercises.map((exercise) => ({
      id: exercise.id,
      name: exercise.name,
      sets: String(exercise.sets),
      setOptions: exercise.setOptions ? exercise.setOptions.join(", ") : "",
      reps: exercise.reps,
      weight: exercise.weight,
    })),
    restSeconds: draft.restSeconds,
    soundEnabled: draft.soundEnabled,
  }
}

/** Form for a copy: same content, fresh exercise ids so nothing is shared. */
export function copyForm(source: Workout | SavedWorkout | WorkoutDraft): WorkoutForm {
  const draft = draftFromWorkout(source as Workout | SavedWorkout)
  const form = formFromDraft(draft)
  return { ...form, exercises: form.exercises.map((exercise) => ({ ...exercise, id: newExerciseId() })) }
}

export function formsEqual(a: WorkoutForm, b: WorkoutForm): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function parseCount(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const number = Number(trimmed)
  return number >= 1 && number <= 100 ? number : null
}

const SETS_MESSAGE = "Целое число от 1 до 100"

function parseOptions(value: string): number[] | null {
  const parts = value.split(/[\s,;]+/).filter(Boolean)
  const numbers = parts.map(parseCount)
  return numbers.every((n): n is number => n !== null) ? (numbers as number[]) : null
}

export function validateForm(form: WorkoutForm): { draft: WorkoutDraft } | { errors: FormErrors } {
  const errors: FormErrors = { items: {} }
  let valid = true
  const fail = () => {
    valid = false
  }

  if (!form.label.trim()) { errors.label = "Укажите короткое название"; fail() }
  if (!form.title.trim()) { errors.title = "Укажите заголовок"; fail() }
  if (form.exercises.length === 0) { errors.exercises = "Добавьте хотя бы одно упражнение"; fail() }
  if (form.exercises.length > MAX_EXERCISES) {
    errors.exercises = `Не больше ${MAX_EXERCISES} упражнений`
    fail()
  }

  const exercises: WorkoutDraft["exercises"][number][] = []
  for (const item of form.exercises) {
    const problems: ExerciseErrors = {}
    if (!item.name.trim()) problems.name = "Укажите название"
    if (!item.reps.trim()) problems.reps = "Укажите повторения"
    const sets = parseCount(item.sets)
    if (sets === null) problems.sets = SETS_MESSAGE
    let options: number[] | undefined
    if (item.setOptions.trim()) {
      const parsed = parseOptions(item.setOptions)
      if (!parsed) problems.setOptions = "Числа от 1 до 100 через запятую"
      else if (new Set(parsed).size !== parsed.length) problems.setOptions = "Варианты не должны повторяться"
      else if (sets !== null && !parsed.includes(sets)) problems.setOptions = "Варианты должны включать число подходов"
      else options = parsed
    }
    if (Object.keys(problems).length) {
      errors.items[item.id] = problems
      fail()
      continue
    }
    exercises.push({
      id: item.id,
      name: item.name.trim(),
      sets: sets as number,
      reps: item.reps.trim(),
      weight: item.weight.trim(),
      ...(options ? { setOptions: options } : {}),
    })
  }

  if (!valid) return { errors }
  return {
    draft: {
      label: form.label.trim(),
      title: form.title.trim(),
      exercises,
      restSeconds: form.restSeconds,
      soundEnabled: form.soundEnabled,
    },
  }
}

export const REST_CHOICES = REST_PRESETS

const STORAGE_MESSAGES: Record<WorkoutStorageError, string> = {
  unavailable: "Хранилище браузера недоступно.",
  quota: "В хранилище браузера не хватает места.",
  corrupt: "Сохранённые тренировки повреждены и не читаются.",
  "unsupported-version": "Сохранённые тренировки записаны несовместимой версией приложения.",
  invalid: "Данные тренировки не прошли проверку.",
  "not-found": "Тренировка не найдена — возможно, она уже удалена.",
  "write-failed": "Не удалось записать данные в хранилище.",
}

export function storageErrorMessage(result: Extract<StorageResult<unknown>, { ok: false }>): string {
  return STORAGE_MESSAGES[result.error]
}
