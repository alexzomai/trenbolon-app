/**
 * Static workout plan. The plan itself never changes at runtime — only the
 * per-exercise weight/reps overrides and the completed-set marks do.
 */

export interface Exercise {
  /** Stable key used for state and localStorage. */
  id: string
  name: string
  /** Number of sets ("подходы") for this exercise. */
  sets: number
  /** Default repetitions, free-form so ranges like "8–10" are allowed. */
  reps: string
  /** Default weight in kg, free-form, empty when not prescribed. */
  weight: string
}

export const WORKOUT_TITLE = "Тренировка: грудь и плечи"

export const EXERCISES: readonly Exercise[] = [
  { id: "bench-press", name: "Жим лёжа", sets: 3, reps: "8–10", weight: "10–13" },
  { id: "incline-press", name: "Жим на наклонной", sets: 3, reps: "10", weight: "" },
  { id: "seated-dumbbell-press", name: "Жим гантелей сидя", sets: 3, reps: "10–12", weight: "" },
  {
    id: "lateral-raise",
    name: "Разведение гантелей в стороны стоя",
    sets: 3,
    reps: "12–15",
    weight: "",
  },
  { id: "pec-deck", name: "Бабочка", sets: 3, reps: "10–12", weight: "42–45" },
] as const

/** Total number of sets across the whole workout (15). */
export const TOTAL_SETS = EXERCISES.reduce((total, exercise) => total + exercise.sets, 0)

/** Rest presets in seconds, offered as buttons in the timer panel. */
export const REST_PRESETS = [60, 90, 120, 180] as const

export type RestPreset = (typeof REST_PRESETS)[number]

export const DEFAULT_REST_SECONDS: RestPreset = 90
