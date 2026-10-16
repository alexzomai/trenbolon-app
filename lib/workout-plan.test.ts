import { describe, expect, it } from "vitest"

import {
  DEFAULT_WORKOUT_ID,
  REST_PRESETS,
  ROTATION_NOTE,
  WORKOUTS,
  WORKOUT_IDS,
  getWorkout,
  isWorkoutId,
  maxSets,
  plannedTotalSets,
} from "./workout-plan"

describe("plan shape", () => {
  it("offers exactly three workouts, Pull first", () => {
    expect(WORKOUT_IDS).toEqual(["pull", "push", "legs"])
    expect(DEFAULT_WORKOUT_ID).toBe("pull")
    expect(WORKOUT_IDS.map((id) => WORKOUTS[id].label)).toEqual([
      "Спина",
      "Грудь",
      "Ноги",
    ])
  })

  it("has six exercises in every workout", () => {
    for (const id of WORKOUT_IDS) {
      expect(getWorkout(id).exercises).toHaveLength(6)
    }
  })

  it("totals 19 sets for Pull and 18 each for Push and Legs", () => {
    expect(plannedTotalSets(getWorkout("pull"))).toBe(19)
    expect(plannedTotalSets(getWorkout("push"))).toBe(18)
    expect(plannedTotalSets(getWorkout("legs"))).toBe(18)
  })

  it("uses globally unique exercise ids", () => {
    const ids = WORKOUT_IDS.flatMap((id) => getWorkout(id).exercises.map((e) => e.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("names the day and the muscle groups of each workout", () => {
    expect(getWorkout("pull").title).toBe("Спина")
    expect(getWorkout("pull").description).toBe("спина, бицепс, задние дельты")
    expect(getWorkout("push").title).toBe("Грудь")
    expect(getWorkout("push").description).toBe("грудь, плечи, трицепс")
    expect(getWorkout("legs").title).toBe("Ноги")
    expect(getWorkout("legs").description).toBe("ноги и пресс")
  })

  it("carries the rotation note from the source plan", () => {
    expect(ROTATION_NOTE).toBe("Через день по кругу: Спина → Грудь → Ноги → Спина → Грудь → Ноги…")
  })

  it("keeps the rest presets and validates workout ids", () => {
    expect(REST_PRESETS).toEqual([60, 90, 120, 180])
    expect(isWorkoutId("push")).toBe(true)
    expect(isWorkoutId("arms")).toBe(false)
    expect(isWorkoutId("")).toBe(false)
    expect(isWorkoutId(undefined)).toBe(false)
  })

  it("rejects inherited object keys", () => {
    expect(isWorkoutId("constructor")).toBe(false)
    expect(isWorkoutId("toString")).toBe(false)
    expect(isWorkoutId("__proto__")).toBe(false)
  })
})

describe("Pull day matches the source", () => {
  const exercises = getWorkout("pull").exercises

  it("keeps the source order, sets and reps", () => {
    expect(
      exercises.map((exercise) => [exercise.name, exercise.sets, exercise.reps])
    ).toEqual([
      ["Тяга верхнего блока широким хватом", 4, "8–12"],
      ["Горизонтальная тяга", 3, "10–12"],
      ["Тяга в наклоне", 3, "10"],
      ["Разведение гантелей в наклоне", 3, "12–15"],
      ["Шраги со штангой/гантелями", 3, "12"],
      ["Бицепс стоя", 3, "10"],
    ])
  })

  it("prescribes a weight only where the source does", () => {
    expect(exercises.map((exercise) => exercise.weight)).toEqual([
      "",
      "",
      "",
      "",
      "",
      "10",
    ])
  })

  it("moves the parenthetical technique notes into hints", () => {
    const hintFor = (id: string) => exercises.find((e) => e.id === id)?.hint
    expect(hintFor("seated-row")).toBe("блок сидя, к животу")
    expect(hintFor("bent-over-row")).toBe("или нижний блок узким хватом")
    expect(hintFor("rear-delt-raise")).toBe("задняя дельта, лёгкий вес")
    expect(hintFor("biceps-curl")).toBe(
      "слегка согнутые колени, руки прямые, чуть выведены вперёд; гантели"
    )
  })
})

describe("Push day matches the source", () => {
  const exercises = getWorkout("push").exercises

  it("keeps the five original exercises, in order, with their ids", () => {
    expect(exercises.slice(0, 5).map((exercise) => exercise.id)).toEqual([
      "bench-press",
      "incline-press",
      "seated-dumbbell-press",
      "lateral-raise",
      "pec-deck",
    ])
  })

  it("keeps the source sets, reps and weights", () => {
    expect(
      exercises.map((exercise) => [exercise.name, exercise.sets, exercise.reps, exercise.weight])
    ).toEqual([
      ["Жим лёжа", 3, "8–10", "10–13"],
      ["Жим на наклонной", 3, "10", ""],
      ["Жим гантелей сидя", 3, "10–12", ""],
      ["Разведение гантелей в стороны стоя", 3, "12–15", ""],
      ["Бабочка", 3, "10–12", "42–45"],
      ["Трицепс на «бычьих яйцах»", 3, "до отказа", "20"],
    ])
  })

  it("offers 2 or 3 sets for the butterfly only, defaulting to 3", () => {
    const pecDeck = exercises.find((exercise) => exercise.id === "pec-deck")!
    expect(pecDeck.setOptions).toEqual([2, 3])
    expect(pecDeck.sets).toBe(3)
    expect(maxSets(pecDeck)).toBe(3)

    for (const exercise of exercises) {
      if (exercise.id === "pec-deck") continue
      expect(exercise.setOptions).toBeUndefined()
      expect(maxSets(exercise)).toBe(exercise.sets)
    }
  })

  it("keeps the drop-set instruction as a hint", () => {
    expect(exercises.at(-1)!.hint).toBe("начинать с 20 кг, понижать по 5 кг")
    expect(exercises.find((e) => e.id === "seated-dumbbell-press")!.hint).toBe("плечи")
    expect(exercises.find((e) => e.id === "lateral-raise")!.hint).toBe("боковая дельта")
  })
})

describe("Legs day matches the source", () => {
  const exercises = getWorkout("legs").exercises

  it("keeps the source order, sets, reps and free-text weight", () => {
    expect(
      exercises.map((exercise) => [exercise.name, exercise.sets, exercise.reps, exercise.weight])
    ).toEqual([
      ["Жим ногами", 3, "10–12", ""],
      ["Сгибание ног лежа на животе", 3, "12", ""],
      ["Разгибание голени", 3, "12", ""],
      ["Подъём на икры стоя", 3, "15", ""],
      ["Пресс на наклонной скамье", 3, "10–15", "свой вес"],
      ["Планка или скручивания на блоке", 3, "до отказа", ""],
    ])
  })

  it("keeps alternatives and target muscles as hints", () => {
    const hintFor = (id: string) => exercises.find((e) => e.id === id)?.hint
    expect(hintFor("leg-press")).toBe("или Смит-приседания")
    expect(hintFor("leg-curl")).toBe("бицепс бедра")
    expect(hintFor("leg-extension")).toBe("квадрицепс")
    expect(hintFor("decline-crunch")).toBe("вниз головой")
  })
})
