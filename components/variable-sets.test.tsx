/**
 * The set-count picker and the ⓘ panel's explanation of it, driven by a fixture
 * exercise. The current plan prescribes a fixed three sets everywhere, so these
 * components are rendered directly with their props rather than through the
 * tracker; the state-level counterpart lives in `lib/variable-sets.test.ts`.
 */

import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ExerciseCard } from "./exercise-card"
import { WorkoutInfo } from "./workout-info"
import type { Exercise, Workout } from "@/lib/workout-plan"

const VARIABLE: Exercise = {
  id: "variable",
  name: "Упражнение с выбором",
  sets: 3,
  setOptions: [2, 3],
  reps: "12–15",
  weight: "",
}

const FIXED: Exercise = {
  id: "fixed",
  name: "Упражнение без выбора",
  sets: 3,
  reps: "12–15",
  weight: "",
}

const FIXTURE: Workout = {
  id: "push",
  label: "Грудь",
  title: "Грудь",
  exercises: [VARIABLE],
}

function renderCard(exercise: Exercise, sets: number, marks: boolean[]) {
  const onSetsChange = vi.fn()
  render(
    <ExerciseCard
      exercise={exercise}
      index={0}
      sets={sets}
      marks={marks}
      weight={exercise.weight}
      reps={exercise.reps}
      onToggleSet={vi.fn()}
      onWeightChange={vi.fn()}
      onRepsChange={vi.fn()}
      onSetsChange={onSetsChange}
    />
  )
  return onSetsChange
}

describe("the set-count picker", () => {
  it("offers the planned counts, marking the one in force", () => {
    renderCard(VARIABLE, 3, [false, false, false])

    expect(screen.getByRole("radio", { name: "3 подхода" })).toHaveAttribute(
      "aria-checked",
      "true"
    )
    expect(screen.getByRole("radio", { name: "2 подхода" })).toHaveAttribute(
      "aria-checked",
      "false"
    )
    expect(screen.getAllByRole("button", { name: /подход \d:/i })).toHaveLength(3)
  })

  it("reports a pick, and renders only the chosen number of set buttons", () => {
    const onSetsChange = renderCard(VARIABLE, 3, [false, false, false])
    fireEvent.click(screen.getByRole("radio", { name: "2 подхода" }))
    expect(onSetsChange).toHaveBeenCalledWith(2)
  })

  it("hides marks beyond the chosen count without counting them", () => {
    renderCard(VARIABLE, 2, [false, false, true])

    expect(screen.getAllByRole("button", { name: /подход \d:/i })).toHaveLength(2)
    expect(screen.getByText("2 × 12–15")).toBeInTheDocument()
    expect(screen.getByText("0/2")).toBeInTheDocument()
  })

  it("is absent when the plan prescribes a fixed count", () => {
    renderCard(FIXED, 3, [false, false, false])
    expect(screen.queryByRole("radio")).not.toBeInTheDocument()
  })
})

describe("the info panel's set-count section", () => {
  it("states the planned range and the parked marks", () => {
    render(
      <WorkoutInfo
        workout={FIXTURE}
        hiddenMarks={[{ id: "variable", name: VARIABLE.name, count: 1 }]}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Информация о тренировке" }))
    const dialog = screen.getByRole("dialog")

    expect(
      within(dialog).getByText(/Упражнение с выбором: по плану 2–3 подхода/)
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText(/Упражнение с выбором: отмечено подходов сверх выбранных — 1/)
    ).toBeInTheDocument()
  })

  it("says nothing about set counts when no exercise offers a choice", () => {
    render(<WorkoutInfo workout={{ ...FIXTURE, exercises: [FIXED] }} hiddenMarks={[]} />)
    fireEvent.click(screen.getByRole("button", { name: "Информация о тренировке" }))

    expect(screen.queryByText(/Выбор числа подходов/)).not.toBeInTheDocument()
    expect(screen.queryByText(/по плану/)).not.toBeInTheDocument()
  })
})
