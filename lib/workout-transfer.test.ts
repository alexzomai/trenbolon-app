import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { draftFromWorkout } from "./saved-workouts"
import {
  AI_PROMPT,
  MAX_IMPORT_CHARS,
  MAX_IMPORT_WORKOUTS,
  MAX_REPORTED_ERRORS,
  SAMPLE_JSON,
  buildExportJson,
  parseWorkoutImport,
} from "./workout-transfer"
import { MAX_REST_SECONDS, MIN_REST_SECONDS, WORKOUTS } from "./workout-plan"

let counter = 0
const ids = () => `ex-${++counter}`
const workout = (over: Record<string, unknown> = {}) => ({
  label: "Л", title: "Т", restSeconds: 90, soundEnabled: true,
  exercises: [{ name: "Присед", sets: 3, reps: "10", weight: "" }], ...over,
})
const envelope = (...workouts: unknown[]) => JSON.stringify({ version: 1, workouts })
const errorsOf = (text: string) => {
  const result = parseWorkoutImport(text, ids)
  if (result.ok) throw new Error("expected failure")
  return result.errors
}

describe("parseWorkoutImport", () => {
  it("accepts the sample, the public example and trims strings", () => {
    const sample = parseWorkoutImport(SAMPLE_JSON, ids)
    expect(sample.ok).toBe(true)
    expect(readFileSync("public/workout-import-example.json", "utf8")).toBe(SAMPLE_JSON)
    const trimmed = parseWorkoutImport(envelope(workout({ label: " Л ", exercises: [{ name: " А ", sets: 1, reps: " 5 ", weight: " 1 " }] })), ids)
    expect(trimmed).toMatchObject({ ok: true, drafts: [{ label: "Л", exercises: [{ name: "А", reps: "5", weight: "1" }] }] })
  })

  it("generates fresh unique exercise ids", () => {
    const result = parseWorkoutImport(envelope(workout(), workout()))
    if (!result.ok) throw new Error("fail")
    const all = result.drafts.flatMap((d) => d.exercises.map((e) => e.id))
    expect(new Set(all).size).toBe(2)
    expect(all.every((id) => id.startsWith("ex-"))).toBe(true)
  })

  it("roundtrips export → import without exposing ids", () => {
    const draft = draftFromWorkout(WORKOUTS.pull, 180, false)
    draft.exercises = [{ ...draft.exercises[0], setOptions: [2, 3], sets: 3 }, ...draft.exercises.slice(1)]
    const json = buildExportJson([draft, draftFromWorkout(WORKOUTS.legs)])
    expect(json).not.toMatch(/"id"/)
    expect(JSON.parse(json).version).toBe(1)
    const result = parseWorkoutImport(json, ids)
    if (!result.ok) throw new Error(result.errors.join("\n"))
    const strip = (d: typeof draft) => ({ ...d, exercises: d.exercises.map((e) => ({ ...e, id: "" })) })
    expect(result.drafts.map(strip)).toEqual([draft, draftFromWorkout(WORKOUTS.legs)].map(strip))
  })

  it("explains bad JSON and wrong envelope", () => {
    expect(errorsOf("{oops")[0]).toMatch(/не корректный JSON/)
    expect(errorsOf("")[0]).toMatch(/Вставьте JSON/)
    expect(errorsOf("[]")[0]).toMatch(/объектом/)
    expect(errorsOf(JSON.stringify({ version: 2, workouts: [workout()] }))[0]).toMatch(/«version».*1.*2/)
    expect(errorsOf(JSON.stringify({ workouts: [workout()] }))[0]).toMatch(/не указано/)
    expect(errorsOf(JSON.stringify({ version: 1 }))).toEqual(expect.arrayContaining([expect.stringMatching(/«workouts»/)]))
    expect(errorsOf(envelope())[0]).toMatch(/пуст/)
    expect(errorsOf(JSON.stringify({ version: 1, workouts: [workout()], extra: 1 }))[0]).toMatch(/неизвестное поле «extra»/)
  })

  it.each([
    [{ label: "  " }, /Тренировка 1: поле «label» не должно быть пустым/],
    [{ title: 5 }, /«title» должно быть строкой/],
    [{ restSeconds: 0 }, /«restSeconds» — целое число секунд от 1 до 3600.*0/],
    [{ restSeconds: 3601 }, /«restSeconds»/],
    [{ restSeconds: 90.5 }, /«restSeconds»/],
    [{ restSeconds: "90" }, /«restSeconds»/],
    [{ soundEnabled: "true" }, /«soundEnabled».*true или false/],
    [{ exercises: [] }, /хотя бы одно упражнение/],
    [{ exercises: "x" }, /«exercises» — массив/],
    [{ extra: 1 }, /неизвестное поле «extra»/],
    [{ id: "user:1" }, /поле «id» не нужно/],
  ])("rejects workout %j", (over, message) => {
    expect(errorsOf(envelope(workout(over))).join("\n")).toMatch(message)
  })

  it.each([
    [{ sets: 0 }, /упражнение 1: поле «sets» — целое число от 1 до 100/],
    [{ sets: 101 }, /«sets»/],
    [{ sets: 1.5 }, /«sets»/],
    [{ sets: "3" }, /«sets»/],
    [{ name: "" }, /«name» не должно быть пустым/],
    [{ reps: 10 }, /«reps» должно быть строкой/],
    [{ weight: 20 }, /«weight» должно быть строкой/],
    [{ setOptions: [] }, /«setOptions»/],
    [{ setOptions: [2, 2, 3] }, /не должны повторяться/],
    [{ setOptions: [2, 4] }, /должен содержать значение «sets» \(3\)/],
    [{ setOptions: [3, 101] }, /«setOptions»/],
    [{ setOptions: "3" }, /«setOptions»/],
    [{ id: "x" }, /поле «id» не нужно/],
  ])("rejects exercise %j", (over, message) => {
    const exercise = { name: "А", sets: 3, reps: "10", weight: "", ...over }
    expect(errorsOf(envelope(workout({ exercises: [exercise] }))).join("\n")).toMatch(message)
  })

  it("is atomic: one bad item rejects the batch and errors name the item", () => {
    const good = workout()
    const bad = workout({ exercises: [{ name: "А", sets: 3, reps: "1", weight: "" }, { name: "Б", sets: 0, reps: "1", weight: "" }] })
    const result = parseWorkoutImport(envelope(good, bad), ids)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors).toEqual([expect.stringContaining("Тренировка 2, упражнение 2")])
  })

  it("enforces size and count limits", () => {
    expect(errorsOf("x".repeat(MAX_IMPORT_CHARS + 1))[0]).toMatch(/слишком большой/)
    const many = Array.from({ length: MAX_IMPORT_WORKOUTS + 1 }, () => workout())
    expect(errorsOf(envelope(...many))[0]).toMatch(/не больше 50/)
    const exercises = Array.from({ length: 1001 }, () => ({ name: "А", sets: 1, reps: "1", weight: "" }))
    expect(errorsOf(envelope(workout({ exercises }))).join()).toMatch(/не больше 1000/)
    const atLimit = Array.from({ length: 1000 }, () => ({ name: "А", sets: 1, reps: "1", weight: "" }))
    expect(parseWorkoutImport(envelope(workout({ exercises: atLimit })), ids).ok).toBe(true)
  })

  it("caps the reported errors", () => {
    const many = Array.from({ length: 40 }, () => workout({ label: "" }))
    const result = parseWorkoutImport(envelope(...many), ids)
    expect(result).toMatchObject({ ok: false, truncated: true })
    if (!result.ok) expect(result.errors).toHaveLength(MAX_REPORTED_ERRORS)
  })

  it("rejects prototype keys as unknown fields without polluting objects", () => {
    const text = '{"version":1,"workouts":[{"__proto__":{"x":1},"label":"Л","title":"Т","restSeconds":90,"soundEnabled":true,"exercises":[{"name":"А","sets":1,"reps":"1","weight":""}]}]}'
    expect(errorsOf(text).join()).toMatch(/неизвестное поле «__proto__»/)
    expect(({} as Record<string, unknown>).x).toBeUndefined()
  })
})

describe("published artifacts", () => {
  it("schema limits match the code and the prompt embeds the sample", () => {
    const schema = JSON.parse(readFileSync("public/workout-import.schema.json", "utf8"))
    expect(schema.properties.workouts.maxItems).toBe(MAX_IMPORT_WORKOUTS)
    expect(schema.$defs.workout.properties.restSeconds).toMatchObject({
      type: "integer", minimum: MIN_REST_SECONDS, maximum: MAX_REST_SECONDS,
    })
    expect(schema.$defs.workout.properties.exercises.maxItems).toBe(1000)
    expect(schema.$defs.exercise.properties.sets.maximum).toBe(100)
    expect(schema.$defs.exercise.additionalProperties).toBe(false)
    expect(AI_PROMPT).toContain(SAMPLE_JSON)
    expect(AI_PROMPT).toMatch(/целое число секунд от 1 до 3600/)
  })
})
