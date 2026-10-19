/**
 * JSON import/export of saved-workout definitions. Pure: no React, no storage.
 *
 * Envelope: `{ "version": 1, "workouts": [ { label, title, restSeconds,
 * soundEnabled, exercises: [ { name, sets, setOptions?, reps, weight } ] } ] }`.
 * Internal IDs are never exported and are rejected on import; they are generated
 * locally. Limits mirror the repository (`validDraft`), so anything accepted
 * here is accepted by `savedWorkouts.importDrafts`.
 */

import {
  MAX_EXERCISES_PER_WORKOUT,
  MAX_SETS,
  type SavedWorkout,
  type WorkoutDraft,
} from "./saved-workouts"
import { newExerciseId } from "./workout-editor"
import { MAX_REST_SECONDS, MIN_REST_SECONDS, isRestSeconds } from "./workout-plan"

export const TRANSFER_VERSION = 1
export const MAX_IMPORT_CHARS = 1_000_000
export const MAX_IMPORT_WORKOUTS = 50
export const MAX_REPORTED_ERRORS = 20
export { MAX_EXERCISES_PER_WORKOUT, MAX_SETS }

export type ParseResult =
  | { ok: true; drafts: WorkoutDraft[] }
  | { ok: false; errors: string[]; truncated: boolean }

const WORKOUT_KEYS = ["label", "title", "restSeconds", "soundEnabled", "exercises"]
const EXERCISE_KEYS = ["name", "sets", "setOptions", "reps", "weight"]

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_SETS
const SETS_RULE = `целое число от 1 до ${MAX_SETS}`
const REST_RULE = `целое число секунд от ${MIN_REST_SECONDS} до ${MAX_REST_SECONDS}`

class Collector {
  errors: string[] = []
  truncated = false
  add(message: string) {
    if (this.errors.length < MAX_REPORTED_ERRORS) this.errors.push(message)
    else this.truncated = true
  }
}

function checkKeys(item: Record<string, unknown>, allowed: string[], where: string, out: Collector) {
  for (const key of Object.keys(item)) {
    if (allowed.includes(key)) continue
    out.add(
      key === "id"
        ? `${where}: поле «id» не нужно — внутренние ID создаются при импорте. Удалите его.`
        : `${where}: неизвестное поле «${key}». Допустимые поля: ${allowed.join(", ")}.`
    )
  }
}

function requiredText(item: Record<string, unknown>, key: string, where: string, out: Collector, blankOk = false) {
  const value = item[key]
  if (value === undefined) {
    out.add(`${where}: нет поля «${key}».`)
    return null
  }
  if (typeof value !== "string") {
    out.add(`${where}: поле «${key}» должно быть строкой, например "текст".`)
    return null
  }
  const trimmed = value.trim()
  if (!trimmed && !blankOk) {
    out.add(`${where}: поле «${key}» не должно быть пустым.`)
    return null
  }
  return trimmed
}

function parseExercise(
  raw: unknown, where: string, out: Collector, newId: () => string,
): WorkoutDraft["exercises"][number] | null {
  if (!isObject(raw)) {
    out.add(`${where}: ожидается объект с полями name, sets, reps, weight.`)
    return null
  }
  const before = out.errors.length + (out.truncated ? 1 : 0)
  checkKeys(raw, EXERCISE_KEYS, where, out)
  const name = requiredText(raw, "name", where, out)
  const reps = requiredText(raw, "reps", where, out)
  const weight = requiredText(raw, "weight", where, out, true)
  let sets: number | null = null
  if (raw.sets === undefined) out.add(`${where}: нет поля «sets».`)
  else if (!isCount(raw.sets)) out.add(`${where}: поле «sets» — ${SETS_RULE} (сейчас: ${JSON.stringify(raw.sets)}).`)
  else sets = raw.sets
  let setOptions: number[] | undefined
  if (raw.setOptions !== undefined) {
    const options = raw.setOptions
    if (!Array.isArray(options) || !options.length || !options.every(isCount)) {
      out.add(`${where}: поле «setOptions» — непустой массив чисел, каждое ${SETS_RULE}, например [2, 3].`)
    } else if (new Set(options).size !== options.length) {
      out.add(`${where}: в «setOptions» числа не должны повторяться.`)
    } else if (sets !== null && !options.includes(sets)) {
      out.add(`${where}: «setOptions» должен содержать значение «sets» (${sets}).`)
    } else setOptions = [...options]
  }
  if (out.errors.length + (out.truncated ? 1 : 0) !== before || name === null || reps === null || weight === null || sets === null) {
    return null
  }
  return { id: newId(), name, sets, reps, weight, ...(setOptions ? { setOptions } : {}) }
}

function parseWorkout(raw: unknown, where: string, out: Collector, newId: () => string): WorkoutDraft | null {
  if (!isObject(raw)) {
    out.add(`${where}: ожидается объект с полями label, title, restSeconds, soundEnabled, exercises.`)
    return null
  }
  const before = out.errors.length + (out.truncated ? 1 : 0)
  checkKeys(raw, WORKOUT_KEYS, where, out)
  const label = requiredText(raw, "label", where, out)
  const title = requiredText(raw, "title", where, out)
  let restSeconds: number | null = null
  if (raw.restSeconds === undefined) out.add(`${where}: нет поля «restSeconds».`)
  else if (!isRestSeconds(raw.restSeconds)) {
    out.add(`${where}: поле «restSeconds» — ${REST_RULE}, сейчас: ${JSON.stringify(raw.restSeconds)}.`)
  } else restSeconds = raw.restSeconds
  let soundEnabled: boolean | null = null
  if (raw.soundEnabled === undefined) out.add(`${where}: нет поля «soundEnabled».`)
  else if (typeof raw.soundEnabled !== "boolean") out.add(`${where}: поле «soundEnabled» — true или false без кавычек.`)
  else soundEnabled = raw.soundEnabled

  const exercises: WorkoutDraft["exercises"][number][] = []
  if (!Array.isArray(raw.exercises)) {
    out.add(`${where}: поле «exercises» — массив упражнений.`)
  } else if (!raw.exercises.length) {
    out.add(`${where}: добавьте хотя бы одно упражнение в «exercises».`)
  } else if (raw.exercises.length > MAX_EXERCISES_PER_WORKOUT) {
    out.add(`${where}: не больше ${MAX_EXERCISES_PER_WORKOUT} упражнений (сейчас ${raw.exercises.length}).`)
  } else {
    raw.exercises.forEach((item, index) => {
      const parsed = parseExercise(item, `${where}, упражнение ${index + 1}`, out, newId)
      if (parsed) exercises.push(parsed)
    })
  }
  if (
    out.errors.length + (out.truncated ? 1 : 0) !== before ||
    label === null || title === null || restSeconds === null || soundEnabled === null
  ) return null
  return { label, title, exercises, restSeconds, soundEnabled }
}

/** Validates the whole text; any problem rejects the whole batch. */
export function parseWorkoutImport(input: string, newId: () => string = newExerciseId): ParseResult {
  const out = new Collector()
  const fail = (): ParseResult => ({ ok: false, errors: out.errors, truncated: out.truncated })
  if (!input.trim()) {
    out.add("Вставьте JSON или выберите файл.")
    return fail()
  }
  if (input.length > MAX_IMPORT_CHARS) {
    out.add(`Текст слишком большой: не больше ${MAX_IMPORT_CHARS.toLocaleString("ru-RU")} символов.`)
    return fail()
  }
  let data: unknown
  try {
    data = JSON.parse(input)
  } catch (error) {
    const detail = error instanceof Error ? ` (${error.message})` : ""
    out.add(`Это не корректный JSON${detail}. Проверьте скобки, запятые и двойные кавычки.`)
    return fail()
  }
  if (!isObject(data)) {
    out.add('Верхний уровень должен быть объектом {"version":1,"workouts":[…]}.')
    return fail()
  }
  checkKeys(data, ["version", "workouts"], "Файл", out)
  if (data.version !== TRANSFER_VERSION) {
    out.add(`Поле «version» должно быть числом ${TRANSFER_VERSION} (сейчас: ${data.version === undefined ? "не указано" : JSON.stringify(data.version)}).`)
  }
  if (!Array.isArray(data.workouts)) {
    out.add("Поле «workouts» — массив тренировок.")
    return fail()
  }
  if (!data.workouts.length) out.add("Массив «workouts» пуст: добавьте хотя бы одну тренировку.")
  else if (data.workouts.length > MAX_IMPORT_WORKOUTS) {
    out.add(`За один раз можно импортировать не больше ${MAX_IMPORT_WORKOUTS} тренировок (сейчас ${data.workouts.length}).`)
  }
  if (out.errors.length) return fail()
  const drafts: WorkoutDraft[] = []
  data.workouts.forEach((raw, index) => {
    const draft = parseWorkout(raw, `Тренировка ${index + 1}`, out, newId)
    if (draft) drafts.push(draft)
  })
  return out.errors.length ? fail() : { ok: true, drafts }
}

/** Export text: pretty JSON, no internal IDs. Round-trips through `parseWorkoutImport`. */
export function buildExportJson(workouts: readonly (WorkoutDraft | SavedWorkout)[]): string {
  return JSON.stringify(
    {
      version: TRANSFER_VERSION,
      workouts: workouts.map((workout) => ({
        label: workout.label,
        title: workout.title,
        restSeconds: workout.restSeconds,
        soundEnabled: workout.soundEnabled,
        exercises: workout.exercises.map((exercise) => ({
          name: exercise.name,
          sets: exercise.sets,
          ...(exercise.setOptions ? { setOptions: [...exercise.setOptions] } : {}),
          reps: exercise.reps,
          weight: exercise.weight,
        })),
      })),
    },
    null,
    2
  )
}

export const SAMPLE_JSON = `{
  "version": 1,
  "workouts": [
    {
      "label": "Плечи",
      "title": "Плечи и руки",
      "restSeconds": 90,
      "soundEnabled": true,
      "exercises": [
        { "name": "Жим гантелей сидя", "sets": 3, "reps": "10–12", "weight": "16 кг" },
        { "name": "Махи в стороны", "sets": 3, "setOptions": [2, 3, 4], "reps": "12–15", "weight": "8 кг" },
        { "name": "Подтягивания", "sets": 3, "reps": "до отказа", "weight": "" }
      ]
    }
  ]
}
`

export const SAMPLE_FILE_NAME = "workout-import-example.json"
export const SCHEMA_FILE_NAME = "workout-import.schema.json"

export const AI_PROMPT = `Ты помогаешь составить тренировки для приложения «Trenbolon». Ответь ТОЛЬКО одним валидным JSON-документом (без пояснений, без Markdown и без блока \`\`\`) в следующем формате.

Структура:
{"version": 1, "workouts": [ <тренировка>, ... ]}

Тренировка (все поля обязательны, других полей быть не должно):
- label — строка, короткое название для кнопки, не пустое (например "Плечи");
- title — строка, заголовок тренировки, не пустой;
- restSeconds — отдых между подходами, ${REST_RULE} (обычно 90 или 120);
- soundEnabled — true или false (звуковой сигнал по окончании отдыха);
- exercises — непустой массив упражнений, не больше ${MAX_EXERCISES_PER_WORKOUT}; порядок массива = порядок выполнения.

Упражнение:
- name — строка, название, не пустое;
- sets — целое число подходов от 1 до ${MAX_SETS};
- setOptions — НЕОБЯЗАТЕЛЬНО: массив уникальных целых чисел от 1 до ${MAX_SETS}, который обязан содержать значение sets (варианты, из которых можно выбрать число подходов). Не добавляй, если выбор не нужен;
- reps — строка, не пустая, свободный формат: "10", "12–15", "до отказа";
- weight — строка, свободный формат, может быть пустой "" (например "20 кг", "свой вес").

Правила: не добавляй поля id и любые другие поля; числа пиши без кавычек; строки в двойных кавычках; не больше ${MAX_IMPORT_WORKOUTS} тренировок в документе; без комментариев и висячих запятых.

Пример корректного ответа:
${SAMPLE_JSON}
Моё пожелание к тренировке: <опиши цель, уровень, оборудование, число дней и длительность>`
