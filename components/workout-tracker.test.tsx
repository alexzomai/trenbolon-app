import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WorkoutTracker } from "./workout-tracker"
import { SWITCH_WARNING } from "./workout-selector"
import { playBeep, unlockAudio } from "@/lib/beep"
import { getWorkout, type WorkoutId } from "@/lib/workout-plan"
import { createInitialState, workoutReducer, type WorkoutState } from "@/lib/workout-state"
import {
  STORAGE_KEY,
  resetStorageHealthForTests,
  serializeState,
} from "@/lib/workout-storage"

vi.mock("@/lib/beep", () => ({
  isAudioSupported: vi.fn(() => true),
  playBeep: vi.fn(() => true),
  unlockAudio: vi.fn(),
  resetAudioForTests: vi.fn(),
}))

const T0 = 1_700_000_000_000

const PULL = getWorkout("pull")
const PUSH = getWorkout("push")

/** The "Подход N" button of the Nth exercise card (both 1-based). */
function setButton(exerciseIndex: number, setNumber: number): HTMLElement {
  const items = screen.getAllByRole("listitem")
  return within(items[exerciseIndex - 1]).getByRole("button", {
    name: new RegExp(`подход ${setNumber}:`, "i"),
  })
}

function markSet(exerciseIndex: number, setNumber: number) {
  fireEvent.click(setButton(exerciseIndex, setNumber))
}

function timerDisplay(): HTMLElement {
  return screen.getByRole("timer")
}

function workoutChoice(name: string): HTMLElement {
  return screen.getByRole("radio", { name })
}

/** Open the switch confirmation for another workout. */
function requestSwitch(name: string) {
  fireEvent.click(workoutChoice(name))
}

/** Switch workout the way a user does: pick it, then confirm. */
function switchTo(name: string) {
  requestSwitch(name)
  // Scoped to the dialog: "Продолжить" is also the timer's resume label.
  fireEvent.click(
    within(screen.getByRole("alertdialog")).getByRole("button", { name: "Продолжить" })
  )
}

function seedStorage(state: WorkoutState) {
  window.localStorage.setItem(STORAGE_KEY, serializeState(state))
}

function readStorage() {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  return raw === null ? null : JSON.parse(raw)
}

/** A saved session of `workoutId` with one set marked and a rest running. */
function savedSession(workoutId: WorkoutId, exerciseId: string): WorkoutState {
  return workoutReducer(createInitialState(workoutId), {
    type: "toggle-set",
    exerciseId,
    setIndex: 0,
    now: T0,
  })
}

beforeEach(() => {
  window.localStorage.clear()
  // Storage health is module-level state, so a failure observed by one test
  // must not leak into the next.
  resetStorageHealthForTests()
  vi.clearAllMocks()
  vi.useFakeTimers({ now: T0 })
})

afterEach(() => {
  vi.useRealTimers()
  // Undo any Storage.prototype spy so it cannot leak into the next test.
  vi.restoreAllMocks()
})

describe("rendering the plan", () => {
  it("shows the Pull day by default with all 19 set buttons", () => {
    render(<WorkoutTracker />)

    expect(
      screen.getByRole("heading", { level: 1, name: /День 1 — Pull/ })
    ).toBeInTheDocument()
    expect(screen.getByText(/спина, бицепс, задние дельты/)).toBeInTheDocument()

    for (const [index, exercise] of PULL.exercises.entries()) {
      expect(
        screen.getByText(`${index + 1}. ${exercise.name}`, { exact: false })
      ).toBeInTheDocument()
    }

    expect(screen.getAllByRole("button", { name: /подход \d:/i })).toHaveLength(19)
    expect(screen.getByText("0 / 19")).toBeInTheDocument()
    expect(screen.getByText("0%")).toBeInTheDocument()
  })

  it("offers the three workouts and marks the current one", () => {
    render(<WorkoutTracker />)

    expect(screen.getByRole("radiogroup", { name: "Тренировка" })).toBeInTheDocument()
    expect(workoutChoice("Pull")).toHaveAttribute("aria-checked", "true")
    expect(workoutChoice("Push")).toHaveAttribute("aria-checked", "false")
    expect(workoutChoice("Legs + пресс")).toHaveAttribute("aria-checked", "false")
  })

  it("states the rotation", () => {
    render(<WorkoutTracker />)
    expect(
      screen.getByText(/Через день по кругу: Pull → Push → Legs/)
    ).toBeInTheDocument()
  })

  it("gives the four-set exercise four buttons", () => {
    render(<WorkoutTracker />)
    const first = screen.getAllByRole("listitem")[0]

    expect(within(first).getAllByRole("button", { name: /подход \d:/i })).toHaveLength(4)
    expect(within(first).getByText("4 × 8–12")).toBeInTheDocument()
  })

  it("moves parenthetical technique notes into hints instead of the title", () => {
    render(<WorkoutTracker />)
    const second = screen.getAllByRole("listitem")[1]

    expect(within(second).getByText("2. Горизонтальная тяга")).toBeInTheDocument()
    expect(within(second).getByText("блок сидя, к животу")).toBeInTheDocument()
  })

  it("seeds the editable weight and reps fields from the plan", () => {
    render(<WorkoutTracker />)

    expect(screen.getByLabelText(/Вес в кг, Тяга верхнего блока широким хватом/)).toHaveValue("")
    expect(screen.getByLabelText(/Вес в кг, Бицепс стоя/)).toHaveValue("10")
    expect(screen.getByLabelText(/Количество повторений, Шраги/)).toHaveValue("12")
  })

  it("keeps free-text reps and bodyweight of the Legs day", () => {
    render(<WorkoutTracker />)
    switchTo("Legs + пресс")

    expect(screen.getByLabelText(/Вес в кг, Пресс на наклонной скамье/)).toHaveValue("свой вес")
    expect(
      screen.getByLabelText(/Количество повторений, Планка или скручивания на блоке/)
    ).toHaveValue("до отказа")
    expect(screen.getByText("0 / 18")).toBeInTheDocument()
  })

  it("starts idle at 01:30 and does not auto-start the timer on mount", () => {
    render(<WorkoutTracker />)

    expect(timerDisplay()).toHaveTextContent("01:30")
    expect(screen.getByText("Готов к старту")).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(timerDisplay()).toHaveTextContent("01:30")
    expect(screen.getByText("Готов к старту")).toBeInTheDocument()
  })
})

describe("switching workout", () => {
  it("asks for confirmation before changing anything", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)

    requestSwitch("Push")

    const dialog = screen.getByRole("alertdialog")
    expect(within(dialog).getByText(SWITCH_WARNING)).toBeInTheDocument()
    expect(
      within(dialog).getByText(
        "При смене тренировки текущий прогресс, изменённые веса и повторения, таймер и настройки будут сброшены. Продолжить?"
      )
    ).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Отмена" })).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Продолжить" })).toBeInTheDocument()

    // Still the Pull day, untouched, while the question is open. The page
    // behind a modal is aria-hidden, so these are text rather than role queries.
    expect(screen.getByText(/День 1 — Pull/)).toBeInTheDocument()
    expect(screen.getByText("1 / 19")).toBeInTheDocument()
  })

  it("cancelling keeps the workout, the progress and the running timer", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)
    fireEvent.change(screen.getByLabelText(/Вес в кг, Шраги/), { target: { value: "30" } })
    act(() => {
      vi.advanceTimersByTime(20_000)
    })

    requestSwitch("Push")
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Отмена" })
    )

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 1, name: /День 1 — Pull/ })).toBeInTheDocument()
    expect(workoutChoice("Pull")).toHaveAttribute("aria-checked", "true")
    expect(workoutChoice("Push")).toHaveAttribute("aria-checked", "false")
    expect(screen.getByText("1 / 19")).toBeInTheDocument()
    expect(setButton(1, 1)).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByLabelText(/Вес в кг, Шраги/)).toHaveValue("30")
    expect(screen.getByText("Идёт отдых")).toBeInTheDocument()
    expect(timerDisplay()).toHaveTextContent("01:10")
  })

  it("dismissing with Escape also keeps everything", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)

    requestSwitch("Legs + пресс")
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" })

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(screen.getByText("1 / 19")).toBeInTheDocument()
    expect(workoutChoice("Pull")).toHaveAttribute("aria-checked", "true")
  })

  it("confirming starts the chosen workout from fresh defaults", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)
    fireEvent.change(screen.getByLabelText(/Вес в кг, Шраги/), { target: { value: "30" } })
    fireEvent.click(screen.getByRole("button", { name: "120 с" }))
    fireEvent.click(screen.getByLabelText("Звуковой сигнал в конце отдыха"))

    switchTo("Push")

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 1, name: /День 2 — Push/ })).toBeInTheDocument()
    expect(screen.getByText(/грудь, плечи, трицепс/)).toBeInTheDocument()
    expect(workoutChoice("Push")).toHaveAttribute("aria-checked", "true")

    // Marks, edits, preset and sound are all back to this workout's defaults.
    expect(screen.getByText("0 / 18")).toBeInTheDocument()
    expect(screen.getByText("0%")).toBeInTheDocument()
    expect(setButton(1, 1)).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByLabelText(/Вес в кг, Жим лёжа/)).toHaveValue("10–13")
    expect(screen.getByRole("button", { name: "90 с" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByLabelText("Звуковой сигнал в конце отдыха")).toHaveAttribute(
      "aria-checked",
      "true"
    )
    expect(screen.getAllByRole("button", { name: /подход \d:/i })).toHaveLength(18)
  })

  it("stops a running rest, and never starts one, on the switch", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)
    expect(screen.getByText("Идёт отдых")).toBeInTheDocument()

    switchTo("Push")

    expect(screen.getByText("Готов к старту")).toBeInTheDocument()
    expect(timerDisplay()).toHaveTextContent("01:30")

    // The old countdown must not keep ticking or beep after the switch.
    act(() => {
      vi.advanceTimersByTime(5 * 60_000)
    })
    expect(screen.getByText("Готов к старту")).toBeInTheDocument()
    expect(timerDisplay()).toHaveTextContent("01:30")
    expect(playBeep).not.toHaveBeenCalled()
  })

  it("does not replay a finished rest's beep after the switch", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)
    act(() => {
      vi.advanceTimersByTime(95_000)
    })
    expect(playBeep).toHaveBeenCalledTimes(1)

    switchTo("Push")
    act(() => {
      vi.advanceTimersByTime(5 * 60_000)
    })

    expect(playBeep).toHaveBeenCalledTimes(1)
    expect(screen.getByText("Готов к старту")).toBeInTheDocument()
  })

  it("switching back is a fresh workout, not the old session", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)
    switchTo("Push")
    switchTo("Pull")

    expect(screen.getByText("0 / 19")).toBeInTheDocument()
    expect(setButton(1, 1)).toHaveAttribute("aria-pressed", "false")
  })

  it("picking the current workout is a no-op and asks nothing", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)

    fireEvent.click(workoutChoice("Pull"))

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(screen.getByText("1 / 19")).toBeInTheDocument()
    expect(workoutChoice("Pull")).toHaveAttribute("aria-checked", "true")
  })

  it("persists the new workout so a reload keeps it", () => {
    const first = render(<WorkoutTracker />)
    switchTo("Legs + пресс")
    markSet(1, 2)
    expect(readStorage()?.workoutId).toBe("legs")
    first.unmount()

    render(<WorkoutTracker />)

    expect(screen.getByRole("heading", { level: 1, name: /День 3 — Legs \+ пресс/ })).toBeInTheDocument()
    expect(workoutChoice("Legs + пресс")).toHaveAttribute("aria-checked", "true")
    expect(screen.getByText("1 / 18")).toBeInTheDocument()
    expect(setButton(1, 2)).toHaveAttribute("aria-pressed", "true")
  })

  it("keeps only one stored session", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)
    switchTo("Push")
    markSet(1, 1)

    expect(window.localStorage).toHaveLength(1)
    expect(readStorage()?.workoutId).toBe("push")
    expect(readStorage()?.completed).not.toHaveProperty("lat-pulldown-wide")
  })
})

describe("variable set count", () => {
  function selectSets(count: number) {
    const butterfly = screen.getAllByRole("listitem")[4]
    fireEvent.click(within(butterfly).getByRole("radio", { name: `${count} подхода` }))
  }

  function butterflyCard() {
    return screen.getAllByRole("listitem")[4]
  }

  it("shows the planned range and defaults to three sets", () => {
    render(<WorkoutTracker />)
    switchTo("Push")

    const card = butterflyCard()
    expect(within(card).getByText(/по плану 2–3 подхода/)).toBeInTheDocument()
    expect(within(card).getByRole("radio", { name: "3 подхода" })).toHaveAttribute(
      "aria-checked",
      "true"
    )
    expect(within(card).getAllByRole("button", { name: /подход \d:/i })).toHaveLength(3)
    expect(screen.getByText("0 / 18")).toBeInTheDocument()
  })

  it("reflects two sets in the card, the total and the progress", () => {
    render(<WorkoutTracker />)
    switchTo("Push")
    markSet(1, 1)

    selectSets(2)

    const card = butterflyCard()
    expect(within(card).getAllByRole("button", { name: /подход \d:/i })).toHaveLength(2)
    expect(within(card).getByText("2 × 10–12")).toBeInTheDocument()
    expect(screen.getByText("1 / 17")).toBeInTheDocument()
    expect(screen.getByText("6%")).toBeInTheDocument() // 1/17 = 5.88…
  })

  it("explains that a discarded third mark is kept, and brings it back", () => {
    render(<WorkoutTracker />)
    switchTo("Push")

    const thirdSet = within(butterflyCard()).getByRole("button", { name: /подход 3:/i })
    fireEvent.click(thirdSet)
    expect(screen.getByText("1 / 18")).toBeInTheDocument()

    selectSets(2)

    expect(screen.getByText("0 / 17")).toBeInTheDocument()
    expect(
      within(butterflyCard()).getByText(/Отмечено подходов сверх выбранных: 1/)
    ).toBeInTheDocument()

    selectSets(3)
    expect(screen.getByText("1 / 18")).toBeInTheDocument()
    expect(
      within(butterflyCard()).queryByText(/Отмечено подходов сверх выбранных/)
    ).not.toBeInTheDocument()
  })

  it("completes the Push day at 17 sets when two are chosen", () => {
    render(<WorkoutTracker />)
    switchTo("Push")
    selectSets(2)

    for (const [exerciseIndex, exercise] of PUSH.exercises.entries()) {
      const sets = exercise.id === "pec-deck" ? 2 : exercise.sets
      for (let setNumber = 1; setNumber <= sets; setNumber += 1) {
        markSet(exerciseIndex + 1, setNumber)
      }
    }

    expect(screen.getByText("17 / 17")).toBeInTheDocument()
    expect(screen.getByText(/Тренировка завершена — отмечены все 17 подходов/)).toBeInTheDocument()
  })
})

describe("marking sets", () => {
  it("updates aria-pressed, the per-exercise count and overall progress", () => {
    render(<WorkoutTracker />)

    const button = setButton(1, 1)
    expect(button).toHaveAttribute("aria-pressed", "false")

    markSet(1, 1)

    expect(setButton(1, 1)).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText("1 / 19")).toBeInTheDocument()
    expect(screen.getByText("5%")).toBeInTheDocument() // 1/19 = 5.26…
    expect(within(screen.getAllByRole("listitem")[0]).getByText("1/4")).toBeInTheDocument()
  })

  it("starts the rest timer and counts down", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)

    expect(screen.getByText("Идёт отдых")).toBeInTheDocument()
    expect(timerDisplay()).toHaveTextContent("01:30")

    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(timerDisplay()).toHaveTextContent("01:00")
  })

  it("restarts the countdown when the next set is marked", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(timerDisplay()).toHaveTextContent("00:30")

    markSet(1, 2)
    expect(timerDisplay()).toHaveTextContent("01:30")
  })

  it("does not start the timer when a set is unmarked", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)
    fireEvent.click(screen.getByRole("button", { name: "Пропустить" }))
    expect(screen.getByText("Готов к старту")).toBeInTheDocument()

    markSet(1, 1) // now unmarks it
    expect(setButton(1, 1)).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByText("Готов к старту")).toBeInTheDocument()
  })

  it("unlocks the audio context from the click gesture", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)
    expect(unlockAudio).toHaveBeenCalled()
  })

  it("stops the timer and announces completion on the final set", () => {
    render(<WorkoutTracker />)

    for (const [exerciseIndex, exercise] of PULL.exercises.entries()) {
      for (let setNumber = 1; setNumber <= exercise.sets; setNumber += 1) {
        markSet(exerciseIndex + 1, setNumber)
      }
    }

    expect(screen.getByText("19 / 19")).toBeInTheDocument()
    expect(screen.getByText("100%")).toBeInTheDocument()
    expect(screen.getByText(/Тренировка завершена — отмечены все 19 подходов/)).toBeInTheDocument()
    expect(screen.getByText("Готов к старту")).toBeInTheDocument()
    expect(timerDisplay()).toHaveTextContent("01:30")
  })
})

describe("rest timer controls", () => {
  it("disables pause and skip while idle", () => {
    render(<WorkoutTracker />)
    expect(screen.getByRole("button", { name: "Пауза" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Пропустить" })).toBeDisabled()
  })

  it("pauses, freezes the remainder and resumes from it", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)
    act(() => {
      vi.advanceTimersByTime(20_000)
    })

    fireEvent.click(screen.getByRole("button", { name: "Пауза" }))
    expect(screen.getByText("Пауза")).toBeInTheDocument()
    expect(timerDisplay()).toHaveTextContent("01:10")

    act(() => {
      vi.advanceTimersByTime(120_000)
    })
    expect(timerDisplay()).toHaveTextContent("01:10")

    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }))
    expect(screen.getByText("Идёт отдых")).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(timerDisplay()).toHaveTextContent("01:00")
  })

  it("clears the timer on skip", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)
    fireEvent.click(screen.getByRole("button", { name: "Пропустить" }))

    expect(screen.getByText("Готов к старту")).toBeInTheDocument()
    expect(timerDisplay()).toHaveTextContent("01:30")
    // The mark itself stays.
    expect(setButton(1, 1)).toHaveAttribute("aria-pressed", "true")
  })

  it("marks the selected preset with aria-pressed and updates an idle timer", () => {
    render(<WorkoutTracker />)

    expect(screen.getByRole("button", { name: "90 с" })).toHaveAttribute("aria-pressed", "true")

    fireEvent.click(screen.getByRole("button", { name: "120 с" }))
    expect(screen.getByRole("button", { name: "120 с" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "90 с" })).toHaveAttribute("aria-pressed", "false")
    expect(timerDisplay()).toHaveTextContent("02:00")
    expect(screen.getByText("Готов к старту")).toBeInTheDocument()
  })

  it("restarts a running countdown onto the new preset", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)
    act(() => {
      vi.advanceTimersByTime(45_000)
    })
    expect(timerDisplay()).toHaveTextContent("00:45")

    fireEvent.click(screen.getByRole("button", { name: "60 с" }))
    expect(screen.getByText("Идёт отдых")).toBeInTheDocument()
    expect(timerDisplay()).toHaveTextContent("01:00")
  })

  it("keeps a paused timer paused when the preset changes", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)
    fireEvent.click(screen.getByRole("button", { name: "Пауза" }))
    fireEvent.click(screen.getByRole("button", { name: "180 с" }))

    expect(screen.getByText("Пауза")).toBeInTheDocument()
    expect(timerDisplay()).toHaveTextContent("03:00")
  })
})

describe("sound", () => {
  it("beeps once when the rest ends naturally", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)

    act(() => {
      vi.advanceTimersByTime(89_000)
    })
    expect(playBeep).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1_500)
    })
    expect(screen.getByText("Отдых завершён")).toBeInTheDocument()
    expect(timerDisplay()).toHaveTextContent("00:00")
    expect(playBeep).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(playBeep).toHaveBeenCalledTimes(1)
  })

  it("stays silent when the sound checkbox is off", () => {
    render(<WorkoutTracker />)
    fireEvent.click(screen.getByLabelText("Звуковой сигнал в конце отдыха"))
    markSet(1, 1)

    act(() => {
      vi.advanceTimersByTime(95_000)
    })
    expect(screen.getByText("Отдых завершён")).toBeInTheDocument()
    expect(playBeep).not.toHaveBeenCalled()
  })

  it("finishes correctly after a long throttled gap", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)

    act(() => {
      vi.advanceTimersByTime(10 * 60_000)
    })
    expect(screen.getByText("Отдых завершён")).toBeInTheDocument()
    expect(playBeep).toHaveBeenCalledTimes(1)
  })
})

describe("editing weight and reps", () => {
  it("accepts free-form ranges and reflects them in the header", () => {
    render(<WorkoutTracker />)

    const weight = screen.getByLabelText(/Вес в кг, Горизонтальная тяга/)
    fireEvent.change(weight, { target: { value: "20–25" } })
    expect(weight).toHaveValue("20–25")

    const reps = screen.getByLabelText(/Количество повторений, Горизонтальная тяга/)
    fireEvent.change(reps, { target: { value: "6–8" } })
    expect(within(screen.getAllByRole("listitem")[1]).getByText("3 × 6–8")).toBeInTheDocument()
  })

  it("accepts textual reps such as «до отказа»", () => {
    render(<WorkoutTracker />)

    const reps = screen.getByLabelText(/Количество повторений, Шраги/)
    fireEvent.change(reps, { target: { value: "до отказа" } })
    expect(within(screen.getAllByRole("listitem")[4]).getByText("3 × до отказа")).toBeInTheDocument()
  })
})

describe("persistence", () => {
  it("writes nothing on first mount so saved state is never overwritten", () => {
    seedStorage(savedSession("pull", "lat-pulldown-wide"))
    const before = window.localStorage.getItem(STORAGE_KEY)

    render(<WorkoutTracker />)

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(before)
    expect(setButton(1, 1)).toHaveAttribute("aria-pressed", "true")
  })

  it("leaves no record while the workout is still untouched", () => {
    render(<WorkoutTracker />)
    expect(readStorage()).toBeNull()
  })

  it("round-trips marks, edits, set count, preset and sound across a remount", () => {
    const first = render(<WorkoutTracker />)

    switchTo("Push")
    markSet(1, 1)
    markSet(6, 3)
    fireEvent.change(screen.getByLabelText(/Вес в кг, Жим на наклонной/), {
      target: { value: "20–25" },
    })
    fireEvent.change(screen.getByLabelText(/Количество повторений, Бабочка/), {
      target: { value: "8" },
    })
    fireEvent.click(
      within(screen.getAllByRole("listitem")[4]).getByRole("radio", { name: "2 подхода" })
    )
    fireEvent.click(screen.getByRole("button", { name: "120 с" }))
    fireEvent.click(screen.getByLabelText("Звуковой сигнал в конце отдыха"))
    fireEvent.click(screen.getByRole("button", { name: "Пропустить" }))

    expect(readStorage()?.version).toBe(2)
    first.unmount()

    render(<WorkoutTracker />)

    expect(workoutChoice("Push")).toHaveAttribute("aria-checked", "true")
    expect(setButton(1, 1)).toHaveAttribute("aria-pressed", "true")
    expect(setButton(6, 3)).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText("2 / 17")).toBeInTheDocument()
    expect(screen.getByLabelText(/Вес в кг, Жим на наклонной/)).toHaveValue("20–25")
    expect(screen.getByLabelText(/Количество повторений, Бабочка/)).toHaveValue("8")
    expect(
      within(screen.getAllByRole("listitem")[4]).getByRole("radio", { name: "2 подхода" })
    ).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("button", { name: "120 с" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByLabelText("Звуковой сигнал в конце отдыха")).toHaveAttribute(
      "aria-checked",
      "false"
    )
  })

  it("restores a running timer with the time that actually remains", () => {
    seedStorage(savedSession("pull", "lat-pulldown-wide"))

    // Page reopened 30 s later.
    vi.setSystemTime(T0 + 30_000)
    render(<WorkoutTracker />)

    expect(screen.getByText("Идёт отдых")).toBeInTheDocument()
    expect(timerDisplay()).toHaveTextContent("01:00")
    expect(playBeep).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(timerDisplay()).toHaveTextContent("00:50")
  })

  it("restores an expired timer as finished without replaying the beep", () => {
    seedStorage(savedSession("pull", "lat-pulldown-wide"))

    vi.setSystemTime(T0 + 10 * 60_000)
    render(<WorkoutTracker />)

    expect(screen.getByText("Отдых завершён")).toBeInTheDocument()
    expect(timerDisplay()).toHaveTextContent("00:00")
    expect(playBeep).not.toHaveBeenCalled()
  })

  it("restores a paused timer with its frozen remainder", () => {
    const paused = workoutReducer(savedSession("pull", "lat-pulldown-wide"), {
      type: "pause",
      now: T0 + 25_000,
    })
    seedStorage(paused)

    vi.setSystemTime(T0 + 3 * 60 * 60_000)
    render(<WorkoutTracker />)

    expect(screen.getByText("Пауза")).toBeInTheDocument()
    expect(timerDisplay()).toHaveTextContent("01:05")

    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(timerDisplay()).toHaveTextContent("01:05")
  })

  it("falls back to a fresh workout when the saved data is corrupt", () => {
    window.localStorage.setItem(STORAGE_KEY, '{"version":2,"completed":')

    render(<WorkoutTracker />)

    expect(screen.getByText("0 / 19")).toBeInTheDocument()
    expect(workoutChoice("Pull")).toHaveAttribute("aria-checked", "true")
    expect(setButton(1, 1)).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByText("Готов к старту")).toBeInTheDocument()
  })

  it("falls back when the saved data uses an incompatible schema version", () => {
    const record = JSON.parse(serializeState(savedSession("push", "bench-press")))
    record.version = 99
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record))

    render(<WorkoutTracker />)
    expect(screen.getByText("0 / 19")).toBeInTheDocument()
    expect(workoutChoice("Pull")).toHaveAttribute("aria-checked", "true")
  })

  it("falls back when the saved data is the superseded v1 record", () => {
    // The old single-plan schema: no workout id, five exercises.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        completed: {
          "bench-press": [true, true, false],
          "incline-press": [true, false, false],
          "seated-dumbbell-press": [false, false, false],
          "lateral-raise": [false, false, false],
          "pec-deck": [true, true, true],
        },
        weights: {
          "bench-press": "12",
          "incline-press": "20–25",
          "seated-dumbbell-press": "",
          "lateral-raise": "",
          "pec-deck": "45",
        },
        reps: {
          "bench-press": "8",
          "incline-press": "10",
          "seated-dumbbell-press": "10–12",
          "lateral-raise": "12–15",
          "pec-deck": "8",
        },
        soundEnabled: false,
        timer: { status: "paused", durationSeconds: 120, deadline: null, remainingMs: 65_000 },
      })
    )

    render(<WorkoutTracker />)

    expect(screen.getByRole("heading", { level: 1, name: /День 1 — Pull/ })).toBeInTheDocument()
    expect(screen.getByText("0 / 19")).toBeInTheDocument()
    expect(screen.getByText("Готов к старту")).toBeInTheDocument()
    expect(screen.getByLabelText("Звуковой сигнал в конце отдыха")).toHaveAttribute(
      "aria-checked",
      "true"
    )
  })

  it("keeps working and warns when localStorage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError")
    })

    render(<WorkoutTracker />)
    markSet(1, 1)

    expect(screen.getByText("1 / 19")).toBeInTheDocument()
    expect(screen.getByText(/Браузер запретил локальное хранилище/)).toBeInTheDocument()
  })
})

describe("reset", () => {
  it("clears marks, edits, timer and the saved record", () => {
    render(<WorkoutTracker />)

    markSet(1, 1)
    markSet(2, 2)
    fireEvent.change(screen.getByLabelText(/Вес в кг, Горизонтальная тяга/), {
      target: { value: "99" },
    })
    fireEvent.click(screen.getByRole("button", { name: "180 с" }))
    fireEvent.click(screen.getByLabelText("Звуковой сигнал в конце отдыха"))
    expect(readStorage()).not.toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /Начать заново/ }))

    expect(screen.getByText("0 / 19")).toBeInTheDocument()
    expect(screen.getByText("0%")).toBeInTheDocument()
    expect(setButton(1, 1)).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByLabelText(/Вес в кг, Горизонтальная тяга/)).toHaveValue("")
    expect(screen.getByRole("button", { name: "90 с" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByLabelText("Звуковой сигнал в конце отдыха")).toHaveAttribute(
      "aria-checked",
      "true"
    )
    expect(screen.getByText("Готов к старту")).toBeInTheDocument()
    expect(readStorage()).toBeNull()
  })

  it("keeps the current workout and asks nothing", () => {
    render(<WorkoutTracker />)
    switchTo("Push")
    markSet(1, 1)

    fireEvent.click(screen.getByRole("button", { name: /Начать заново/ }))

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 1, name: /День 2 — Push/ })).toBeInTheDocument()
    expect(screen.getByText("0 / 18")).toBeInTheDocument()
    // The selection itself is still worth remembering.
    expect(readStorage()?.workoutId).toBe("push")
  })

  it("leaves a fresh workout after a reload", () => {
    const first = render(<WorkoutTracker />)
    markSet(1, 1)
    fireEvent.click(screen.getByRole("button", { name: /Начать заново/ }))
    first.unmount()

    render(<WorkoutTracker />)
    expect(screen.getByText("0 / 19")).toBeInTheDocument()
  })
})

describe("copying results", () => {
  it("copies the live state of the current workout and confirms success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })

    render(<WorkoutTracker />)
    switchTo("Push")
    markSet(1, 1)
    fireEvent.change(screen.getByLabelText(/Вес в кг, Жим лёжа/), { target: { value: "15" } })

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Скопировать результаты/ }))
    })

    expect(writeText).toHaveBeenCalledTimes(1)
    const text = writeText.mock.calls[0][0] as string
    expect(text).toContain("День 2 — Push (грудь, плечи, трицепс)")
    expect(text).toContain("1. Жим лёжа — 3 × 8–10 повт., вес 15 кг — выполнено 1/3")
    expect(text).toContain("Итого: 1 / 18 подходов (6%)")
    expect(text).not.toContain("Тяга верхнего блока")
    expect(screen.getByText(/Результаты скопированы/)).toBeInTheDocument()
  })

  it("copies the chosen set count, not the planned one", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })

    render(<WorkoutTracker />)
    switchTo("Push")
    fireEvent.click(
      within(screen.getAllByRole("listitem")[4]).getByRole("radio", { name: "2 подхода" })
    )

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Скопировать результаты/ }))
    })

    const text = writeText.mock.calls[0][0] as string
    expect(text).toContain("5. Бабочка — 2 × 10–12 повт., вес 42–45 кг — выполнено 0/2")
    expect(text).toContain("Итого: 0 / 17 подходов (0%)")
  })

  it("copies the default Pull day before anything is switched", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })

    render(<WorkoutTracker />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Скопировать результаты/ }))
    })

    const text = writeText.mock.calls[0][0] as string
    expect(text).toContain("День 1 — Pull (спина, бицепс, задние дельты)")
    expect(text).toContain("Итого: 0 / 19 подходов (0%)")
  })

  it("reports an honest error when the clipboard refuses", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: vi.fn().mockRejectedValue(new Error("нет доступа к буферу обмена")),
      },
      configurable: true,
    })

    render(<WorkoutTracker />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Скопировать результаты/ }))
    })

    expect(
      screen.getByText(/Не удалось скопировать результаты: нет доступа к буферу обмена/)
    ).toBeInTheDocument()
  })

  it("reports an honest error when the clipboard API is missing", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    })

    render(<WorkoutTracker />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Скопировать результаты/ }))
    })

    expect(screen.getByText(/буфер обмена недоступен в этом браузере/)).toBeInTheDocument()
  })
})
