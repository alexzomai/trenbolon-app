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
  /** Short name; parenthetical technique notes live in `hint` instead. */
  name: string
  /** Number of sets ("подходы") prescribed by the plan, and the default. */
  sets: number
  /**
   * Set counts the user may pick from, when the plan prescribes a range
   * ("2–3×..."). Absent for the fixed-set majority.
   */
  setOptions?: readonly number[]
  /** Default repetitions, free-form so "8–12" and "до отказа" are both fine. */
  reps: string
  /** Default weight, free-form, empty when the plan prescribes none. */
  weight: string
  /** Technique, alternative or drop-set note shown under the title. */
  hint?: string
}

export type WorkoutId = "pull" | "push" | "legs"

export interface Workout {
  id: WorkoutId
  /** Short label for the selector. */
  label: string
  /** Heading of the day, e.g. "Спина". */
  title: string
  /** Muscle groups of the day. */
  description: string
  exercises: readonly Exercise[]
}

export const ROTATION_NOTE =
  "Через день по кругу: Спина → Грудь → Ноги → Спина → Грудь → Ноги…"

const PULL: Workout = {
  id: "pull",
  label: "Спина",
  title: "Спина",
  description: "спина, бицепс, задние дельты",
  exercises: [
    {
      id: "lat-pulldown-wide",
      name: "Тяга верхнего блока широким хватом",
      sets: 4,
      reps: "8–12",
      weight: "",
    },
    {
      id: "seated-row",
      name: "Горизонтальная тяга",
      sets: 3,
      reps: "10–12",
      weight: "",
      hint: "блок сидя, к животу",
    },
    {
      id: "bent-over-row",
      name: "Тяга в наклоне",
      sets: 3,
      reps: "10",
      weight: "",
      hint: "или нижний блок узким хватом",
    },
    {
      id: "rear-delt-raise",
      name: "Разведение гантелей в наклоне",
      sets: 3,
      reps: "12–15",
      weight: "",
      hint: "задняя дельта, лёгкий вес",
    },
    { id: "shrugs", name: "Шраги со штангой/гантелями", sets: 3, reps: "12", weight: "" },
    {
      id: "biceps-curl",
      name: "Бицепс стоя",
      sets: 3,
      reps: "10",
      weight: "10",
      hint: "слегка согнутые колени, руки прямые, чуть выведены вперёд; гантели",
    },
  ],
}

const PUSH: Workout = {
  id: "push",
  label: "Грудь",
  title: "Грудь",
  description: "грудь, плечи, трицепс",
  exercises: [
    { id: "bench-press", name: "Жим лёжа", sets: 3, reps: "8–10", weight: "10–13" },
    { id: "incline-press", name: "Жим на наклонной", sets: 3, reps: "10", weight: "" },
    {
      id: "seated-dumbbell-press",
      name: "Жим гантелей сидя",
      sets: 3,
      reps: "10–12",
      weight: "",
      hint: "плечи",
    },
    {
      id: "lateral-raise",
      name: "Разведение гантелей в стороны стоя",
      sets: 3,
      reps: "12–15",
      weight: "",
      hint: "боковая дельта",
    },
    {
      id: "pec-deck",
      name: "Бабочка",
      sets: 3,
      setOptions: [2, 3],
      reps: "10–12",
      weight: "42–45",
    },
    {
      id: "triceps-extension",
      name: "Трицепс на «бычьих яйцах»",
      sets: 3,
      reps: "до отказа",
      weight: "20",
      hint: "начинать с 20 кг, понижать по 5 кг",
    },
  ],
}

const LEGS: Workout = {
  id: "legs",
  label: "Ноги",
  title: "Ноги",
  description: "ноги и пресс",
  exercises: [
    {
      id: "leg-press",
      name: "Жим ногами",
      sets: 3,
      reps: "10–12",
      weight: "",
      hint: "или Смит-приседания",
    },
    {
      id: "leg-curl",
      name: "Сгибание ног лежа на животе",
      sets: 3,
      reps: "12",
      weight: "",
      hint: "бицепс бедра",
    },
    {
      id: "leg-extension",
      name: "Разгибание голени",
      sets: 3,
      reps: "12",
      weight: "",
      hint: "квадрицепс",
    },
    { id: "calf-raise", name: "Подъём на икры стоя", sets: 3, reps: "15", weight: "" },
    {
      id: "decline-crunch",
      name: "Пресс на наклонной скамье",
      sets: 3,
      reps: "10–15",
      weight: "свой вес",
      hint: "вниз головой",
    },
    {
      id: "plank",
      name: "Планка или скручивания на блоке",
      sets: 3,
      reps: "до отказа",
      weight: "",
    },
  ],
}

export const WORKOUTS: Record<WorkoutId, Workout> = { pull: PULL, push: PUSH, legs: LEGS }

/** Selector order, matching the rotation. */
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

/** Total sets of a workout at the plan's default set counts (19 / 18 / 18). */
export function plannedTotalSets(workout: Workout): number {
  return workout.exercises.reduce((total, exercise) => total + exercise.sets, 0)
}

/** Rest presets in seconds, offered as buttons in the timer panel. */
export const REST_PRESETS = [60, 90, 120, 180] as const

export type RestPreset = (typeof REST_PRESETS)[number]

export const DEFAULT_REST_SECONDS: RestPreset = 90
