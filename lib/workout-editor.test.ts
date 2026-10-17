import { describe, expect, it } from "vitest"

import {
  blankForm,
  copyForm,
  formFromDraft,
  formsEqual,
  validateForm,
  type WorkoutForm,
} from "./workout-editor"
import { getWorkout } from "./workout-plan"

function validForm(): WorkoutForm {
  const form = blankForm()
  return {
    ...form,
    label: " Моя ",
    title: "Моя тренировка",
    exercises: [{ ...form.exercises[0], name: " Присед ", sets: "3", reps: "8–10", weight: " 40 " }],
  }
}

describe("workout editor form", () => {
  it("converts a valid form to a trimmed draft keeping exercise ids", () => {
    const form = validForm()
    const result = validateForm(form)
    expect(result).toEqual({
      draft: {
        label: "Моя",
        title: "Моя тренировка",
        restSeconds: 90,
        soundEnabled: true,
        exercises: [{ id: form.exercises[0].id, name: "Присед", sets: 3, reps: "8–10", weight: "40" }],
      },
    })
  })

  it.each(["", "0", "101", "2.5", "-1", "1e1", "abc", " "])("rejects sets %j", (sets) => {
    const form = validForm()
    form.exercises[0].sets = sets
    const result = validateForm(form)
    expect("errors" in result && result.errors.items[form.exercises[0].id].sets).toBeTruthy()
  })

  it.each(["1", "100"])("accepts boundary sets %s", (sets) => {
    const form = validForm()
    form.exercises[0].sets = sets
    expect("draft" in validateForm(form)).toBe(true)
  })

  it("requires label, title, name, reps and at least one exercise", () => {
    const form = validForm()
    const empty = { ...form, label: " ", title: "", exercises: [{ ...form.exercises[0], name: "", reps: " " }] }
    const result = validateForm(empty)
    if (!("errors" in result)) throw new Error("expected errors")
    expect(result.errors.label).toBeTruthy()
    expect(result.errors.title).toBeTruthy()
    expect(result.errors.items[form.exercises[0].id]).toMatchObject({
      name: expect.any(String),
      reps: expect.any(String),
    })
    const none = validateForm({ ...form, exercises: [] })
    expect("errors" in none && none.errors.exercises).toBeTruthy()
  })

  it("validates optional set options", () => {
    const form = validForm()
    const item = form.exercises[0]
    const check = (setOptions: string) => {
      item.setOptions = setOptions
      return validateForm(form)
    }
    const ok = check("2, 3 4")
    expect("draft" in ok && ok.draft.exercises[0].setOptions).toEqual([2, 3, 4])
    expect("errors" in check("2, 4")).toBe(true) // must include sets (3)
    expect("errors" in check("3, 3")).toBe(true)
    expect("errors" in check("3, 0")).toBe(true)
    expect("errors" in check("3, x")).toBe(true)
    expect("errors" in check("3, 101")).toBe(true)
    const none = check("  ")
    expect("draft" in none && "setOptions" in none.draft.exercises[0]).toBe(false)
  })

  it("copies get fresh exercise ids and share no data with the source", () => {
    const pull = getWorkout("pull")
    const copy = copyForm(pull)
    expect(copy.exercises.map((e) => e.name)).toEqual(pull.exercises.map((e) => e.name))
    const ids = new Set(copy.exercises.map((e) => e.id))
    expect(ids.size).toBe(pull.exercises.length)
    for (const exercise of pull.exercises) expect(ids.has(exercise.id)).toBe(false)
    copy.exercises[0].name = "Другое"
    expect(pull.exercises[0].name).not.toBe("Другое")
  })

  it("keeps ids when editing and detects changes", () => {
    const draft = { label: "A", title: "B", restSeconds: 60, soundEnabled: false,
      exercises: [{ id: "x", name: "N", sets: 2, setOptions: [2, 3], reps: "5", weight: "" }] }
    const form = formFromDraft(draft)
    expect(form.exercises[0]).toMatchObject({ id: "x", sets: "2", setOptions: "2, 3" })
    expect(formsEqual(form, formFromDraft(draft))).toBe(true)
    expect(formsEqual(form, { ...form, title: "C" })).toBe(false)
  })
})
