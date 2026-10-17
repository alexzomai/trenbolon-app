/**
 * Static workout plans — a local snapshot of the Obsidian note
 * "План тренировок.md" (Спина / Грудь / Ноги). Nothing here is fetched or synced
 * at runtime; editing this file is how the plan changes.
 *
 * The plan itself never changes while the app runs. Only the per-exercise
 * weight/reps overrides, the chosen set count and the completed-set marks do.
 */

export interface Exercise {
  /** Stable key used for state and localStorage. Unique across all workouts. */
  id: string
  /** Name exactly as the source note writes it, alternatives included. */
  name: string
  /** Number of sets ("подходы") prescribed by the plan, and the default. */
  sets: number
  /**
   * Set counts the user may pick from, when the plan prescribes a range
   * ("2–3×..."). Absent for the fixed-set majority.
   */
  setOptions?: readonly number[]
  /** Default repetitions, free-form so "12–15" and "до отказа" are both fine. */
  reps: string
  /** Default weight, free-form, empty when the plan prescribes none. */
  weight: string
}

export type WorkoutId = "pull" | "push" | "legs"

export interface Workout {
  id: WorkoutId
  /** Short label for the selector. */
  label: string
  /** Heading of the day, e.g. "Спина". */
  title: string
  exercises: readonly Exercise[]
}

/** Every exercise of the current plan: three sets of 12–15, no set weight. */
const REPS = "12–15"

function exercise(id: string, name: string): Exercise {
  return { id, name, sets: 3, reps: REPS, weight: "" }
}

const PULL: Workout = {
  id: "pull",
  label: "Спина",
  title: "Спина",
  exercises: [
    exercise("lat-pulldown-wide", "Тяга верхнего блока широким хватом"),
    exercise("seated-row", "Горизонтальная тяга"),
    exercise("bent-over-row", "Тяга в наклоне / нижний блок узким хватом"),
    exercise("rear-delt-raise", "Разведение гантелей в наклоне"),
    exercise("shrugs", "Шраги со штангой/гантелями"),
    exercise("biceps-curl", "Бицепс стоя"),
    exercise("back-hyperextension", "Гиперэкстензия на поясницу"),
  ],
}

const PUSH: Workout = {
  id: "push",
  label: "Грудь",
  title: "Грудь",
  exercises: [
    exercise("bench-press", "Жим лёжа"),
    exercise("incline-press", "Жим на наклонной"),
    exercise("seated-dumbbell-press", "Жим гантелей сидя"),
    exercise("lateral-raise", "Разведение гантелей в стороны стоя"),
    exercise("pec-deck", "Бабочка"),
    exercise("triceps-extension", "Трицепс на «бычьих яйцах»"),
    exercise("pull-ups", "Подтягивания"),
  ],
}

const LEGS: Workout = {
  id: "legs",
  label: "Ноги",
  title: "Ноги",
  exercises: [
    exercise("leg-press", "Жим ногами или Смит-приседания"),
    exercise("leg-curl", "Сгибание ног лёжа"),
    exercise("leg-extension", "Разгибание голени"),
    exercise("calf-raise", "Подъём на икры стоя"),
    exercise("decline-crunch", "Пресс на наклонной скамье"),
    exercise("neck-curl", "Сгибание шеи лёжа на спине с блином"),
    // Same movement as the back day's closing exercise, but its own session key.
    exercise("legs-hyperextension", "Гиперэкстензия на поясницу"),
  ],
}

export const WORKOUTS: Record<WorkoutId, Workout> = { pull: PULL, push: PUSH, legs: LEGS }

/** Selector order, matching the plan. */
export const WORKOUT_IDS = ["pull", "push", "legs"] as const

export const DEFAULT_WORKOUT_ID: WorkoutId = "pull"

export function isWorkoutId(value: unknown): value is WorkoutId {
  return typeof value === "string" && Object.hasOwn(WORKOUTS, value)
}

export function getWorkout(id: WorkoutId): Workout {
  return WORKOUTS[id]
}

/**
 * How many marks an exercise needs room for: its planned set count, or the
 * largest count it offers. Lowering the chosen count therefore never has to
 * resize (or discard) the marks array.
 */
export function maxSets(exercise: Exercise): number {
  return Math.max(exercise.sets, ...(exercise.setOptions ?? []))
}

/** Total sets of a workout at the plan's default set counts (21 each). */
export function plannedTotalSets(workout: Workout): number {
  return workout.exercises.reduce((total, exercise) => total + exercise.sets, 0)
}

/** Rest presets in seconds, offered as buttons in the timer panel. */
export const REST_PRESETS = [60, 90, 120, 180] as const

export type RestPreset = (typeof REST_PRESETS)[number]

export const DEFAULT_REST_SECONDS: RestPreset = 90
