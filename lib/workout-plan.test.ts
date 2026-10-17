import { describe, expect, it } from "vitest"

import {
  DEFAULT_WORKOUT_ID,
  REST_PRESETS,
  WORKOUTS,
  WORKOUT_IDS,
  getWorkout,
  isWorkoutId,
  maxSets,
  plannedTotalSets,
} from "./workout-plan"

/** The source note, verbatim: seven exercises per day, in order. */
const SOURCE: Record<string, readonly string[]> = {
  pull: [
    "Тяга верхнего блока широким хватом",
    "Горизонтальная тяга",
    "Тяга в наклоне / нижний блок узким хватом",
    "Разведение гантелей в наклоне",
    "Шраги со штангой/гантелями",
    "Бицепс стоя",
    "Гиперэкстензия на поясницу",
  ],
  push: [
    "Жим лёжа",
    "Жим на наклонной",
    "Жим гантелей сидя",
    "Разведение гантелей в стороны стоя",
    "Бабочка",
    "Трицепс на «бычьих яйцах»",
    "Подтягивания",
  ],
  legs: [
    "Жим ногами или Смит-приседания",
    "Сгибание ног лёжа",
    "Разгибание голени",
    "Подъём на икры стоя",
    "Пресс на наклонной скамье",
    "Сгибание шеи лёжа на спине с блином",
    "Гиперэкстензия на поясницу",
  ],
}

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

  it("has seven exercises in every workout", () => {
    for (const id of WORKOUT_IDS) {
      expect(getWorkout(id).exercises).toHaveLength(7)
    }
  })

  it("totals 21 sets for every day", () => {
    for (const id of WORKOUT_IDS) {
      expect(plannedTotalSets(getWorkout(id))).toBe(21)
    }
  })

  it("uses globally unique exercise ids", () => {
    const ids = WORKOUT_IDS.flatMap((id) => getWorkout(id).exercises.map((e) => e.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("gives the two hyperextension rows distinct ids", () => {
    expect(getWorkout("pull").exercises.at(-1)).toMatchObject({
      id: "back-hyperextension",
      name: "Гиперэкстензия на поясницу",
    })
    expect(getWorkout("legs").exercises.at(-1)).toMatchObject({
      id: "legs-hyperextension",
      name: "Гиперэкстензия на поясницу",
    })
  })

  it("names the day without any muscle-group prose", () => {
    expect(getWorkout("pull").title).toBe("Спина")
    expect(getWorkout("push").title).toBe("Грудь")
    expect(getWorkout("legs").title).toBe("Ноги")
    for (const id of WORKOUT_IDS) {
      expect(getWorkout(id)).not.toHaveProperty("description")
    }
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

describe.each(WORKOUT_IDS)("%s day matches the source", (id) => {
  const exercises = getWorkout(id).exercises

  it("keeps the source names in order", () => {
    expect(exercises.map((exercise) => exercise.name)).toEqual(SOURCE[id])
  })

  it("prescribes three sets of 12–15 everywhere, with a fixed count", () => {
    for (const exercise of exercises) {
      expect(exercise.sets).toBe(3)
      expect(exercise.reps).toBe("12–15")
      expect(exercise.setOptions).toBeUndefined()
      expect(maxSets(exercise)).toBe(3)
    }
  })

  it("prescribes no weight at all, not even bodyweight", () => {
    expect(exercises.map((exercise) => exercise.weight)).toEqual(Array(7).fill(""))
  })

  it("carries no technique, drop-set or alternative hints beside the name", () => {
    for (const exercise of exercises) {
      expect(exercise).not.toHaveProperty("hint")
    }
  })
})

describe("the superseded plan is gone", () => {
  const names = WORKOUT_IDS.flatMap((id) => getWorkout(id).exercises.map((e) => e.name))

  it("dropped the plank and the cable crunch", () => {
    expect(names).not.toContain("Планка или скручивания на блоке")
  })

  it("keeps the explicit alternatives inside the exercise names", () => {
    expect(names).toContain("Тяга в наклоне / нижний блок узким хватом")
    expect(names).toContain("Жим ногами или Смит-приседания")
  })

  it("has no leftover weights or rep ranges from the old note", () => {
    const entries = WORKOUT_IDS.flatMap((id) =>
      getWorkout(id).exercises.flatMap((e) => [e.weight, e.reps])
    )
    for (const stale of ["10–13", "42–45", "свой вес", "до отказа", "8–12", "8–10"]) {
      expect(entries).not.toContain(stale)
    }
  })
})
