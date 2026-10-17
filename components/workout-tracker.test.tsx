import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WorkoutTracker } from "./workout-tracker"
import { STOP_ALARM_LABEL } from "./rest-timer"
import { SWITCH_WARNING } from "./workout-selector"
import { startAlarm, stopAlarm, unlockAudio } from "@/lib/beep"
import { getWorkout, type WorkoutId } from "@/lib/workout-plan"
import { createInitialState, workoutReducer, type WorkoutState } from "@/lib/workout-state"
import {
  STORAGE_KEY,
  resetStorageHealthForTests,
  serializeState,
} from "@/lib/workout-storage"

vi.mock("@/lib/beep", () => ({
  isAudioSupported: vi.fn(() => true),
  startAlarm: vi.fn(() => true),
  stopAlarm: vi.fn(),
  unlockAudio: vi.fn(),
  resetAudioForTests: vi.fn(),
}))

const T0 = 1_700_000_000_000

const PULL = getWorkout("pull")

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

/** Open the ⓘ panel and return its dialog element. */
function openInfo(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "Информация о тренировке" }))
  return screen.getByRole("dialog")
}

function closeInfo() {
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Закрыть" }))
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
  it("shows the Pull day by default with all 21 set buttons", () => {
    render(<WorkoutTracker />)

    expect(
      screen.getByRole("heading", { level: 1, name: /Спина/ })
    ).toBeInTheDocument()

    for (const [index, exercise] of PULL.exercises.entries()) {
      expect(
        screen.getByText(`${index + 1}. ${exercise.name}`, { exact: false })
      ).toBeInTheDocument()
    }

    expect(screen.getAllByRole("button", { name: /подход \d:/i })).toHaveLength(21)
    expect(screen.getByText("0 / 21")).toBeInTheDocument()
    expect(screen.getByText("0%")).toBeInTheDocument()
  })

  it("offers the three workouts and marks the current one", () => {
    render(<WorkoutTracker />)

    expect(screen.getByRole("radiogroup", { name: "Тренировка" })).toBeInTheDocument()
    expect(workoutChoice("Спина")).toHaveAttribute("aria-checked", "true")
    expect(workoutChoice("Грудь")).toHaveAttribute("aria-checked", "false")
    expect(workoutChoice("Ноги")).toHaveAttribute("aria-checked", "false")
  })

  it("gives every exercise three set buttons", () => {
    render(<WorkoutTracker />)

    for (const card of screen.getAllByRole("listitem")) {
      expect(within(card).getAllByRole("button", { name: /подход \d:/i })).toHaveLength(3)
      expect(within(card).getByText("3 × 12–15")).toBeInTheDocument()
    }
  })

  it("shows the alternatives the plan names, in the card title itself", () => {
    render(<WorkoutTracker />)
    expect(
      screen.getByText("3. Тяга в наклоне / нижний блок узким хватом")
    ).toBeInTheDocument()

    switchTo("Ноги")
    expect(screen.getByText("1. Жим ногами или Смит-приседания")).toBeInTheDocument()
  })

  it("seeds the editable weight and reps fields from the plan", () => {
    render(<WorkoutTracker />)

    for (const name of ["Тяга верхнего блока широким хватом", "Бицепс стоя"]) {
      expect(screen.getByLabelText(new RegExp(`Вес в кг, ${name}`))).toHaveValue("")
      expect(screen.getByLabelText(new RegExp(`Количество повторений, ${name}`))).toHaveValue(
        "12–15"
      )
    }
  })

  it("prescribes no weight on the Legs day either", () => {
    render(<WorkoutTracker />)
    switchTo("Ноги")

    expect(screen.getByLabelText(/Вес в кг, Пресс на наклонной скамье/)).toHaveValue("")
    expect(
      screen.getByLabelText(/Количество повторений, Сгибание шеи лёжа на спине с блином/)
    ).toHaveValue("12–15")
    expect(screen.getByText("0 / 21")).toBeInTheDocument()
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

    requestSwitch("Грудь")

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
    expect(screen.getAllByText(/Спина/).length).toBeGreaterThan(0)
    expect(screen.getByText("1 / 21")).toBeInTheDocument()
  })

  it("cancelling keeps the workout, the progress and the running timer", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)
    fireEvent.change(screen.getByLabelText(/Вес в кг, Шраги/), { target: { value: "30" } })
    act(() => {
      vi.advanceTimersByTime(20_000)
    })

    requestSwitch("Грудь")
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Отмена" })
    )

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 1, name: /Спина/ })).toBeInTheDocument()
    expect(workoutChoice("Спина")).toHaveAttribute("aria-checked", "true")
    expect(workoutChoice("Грудь")).toHaveAttribute("aria-checked", "false")
    expect(screen.getByText("1 / 21")).toBeInTheDocument()
    expect(setButton(1, 1)).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByLabelText(/Вес в кг, Шраги/)).toHaveValue("30")
    expect(screen.getByText("Идёт отдых")).toBeInTheDocument()
    expect(timerDisplay()).toHaveTextContent("01:10")
  })

  it("dismissing with Escape also keeps everything", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)

    requestSwitch("Ноги")
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" })

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(screen.getByText("1 / 21")).toBeInTheDocument()
    expect(workoutChoice("Спина")).toHaveAttribute("aria-checked", "true")
  })

  it("confirming starts the chosen workout from fresh defaults", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)
    fireEvent.change(screen.getByLabelText(/Вес в кг, Шраги/), { target: { value: "30" } })
    fireEvent.click(screen.getByRole("button", { name: "120 с" }))
    fireEvent.click(screen.getByLabelText("Звуковой сигнал в конце отдыха"))

    switchTo("Грудь")

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 1, name: /Грудь/ })).toBeInTheDocument()
    expect(workoutChoice("Грудь")).toHaveAttribute("aria-checked", "true")

    // Marks, edits, preset and sound are all back to this workout's defaults.
    expect(screen.getByText("0 / 21")).toBeInTheDocument()
    expect(screen.getByText("0%")).toBeInTheDocument()
    expect(setButton(1, 1)).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByLabelText(/Вес в кг, Жим лёжа/)).toHaveValue("")
    expect(screen.getByRole("button", { name: "90 с" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByLabelText("Звуковой сигнал в конце отдыха")).toHaveAttribute(
      "aria-checked",
      "true"
    )
    expect(screen.getAllByRole("button", { name: /подход \d:/i })).toHaveLength(21)
  })

  it("stops a running rest, and never starts one, on the switch", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)
    expect(screen.getByText("Идёт отдых")).toBeInTheDocument()

    switchTo("Грудь")

    expect(screen.getByText("Готов к старту")).toBeInTheDocument()
    expect(timerDisplay()).toHaveTextContent("01:30")

    // The old countdown must not keep ticking or alarm after the switch.
    act(() => {
      vi.advanceTimersByTime(5 * 60_000)
    })
    expect(screen.getByText("Готов к старту")).toBeInTheDocument()
    expect(timerDisplay()).toHaveTextContent("01:30")
    expect(startAlarm).not.toHaveBeenCalled()
  })

  it("does not replay a finished rest's alarm after the switch", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)
    act(() => {
      vi.advanceTimersByTime(95_000)
    })
    expect(startAlarm).toHaveBeenCalledTimes(1)

    switchTo("Грудь")
    act(() => {
      vi.advanceTimersByTime(5 * 60_000)
    })

    expect(startAlarm).toHaveBeenCalledTimes(1)
    expect(screen.getByText("Готов к старту")).toBeInTheDocument()
  })

  it("switching back is a fresh workout, not the old session", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)
    switchTo("Грудь")
    switchTo("Спина")

    expect(screen.getByText("0 / 21")).toBeInTheDocument()
    expect(setButton(1, 1)).toHaveAttribute("aria-pressed", "false")
  })

  it("picking the current workout is a no-op and asks nothing", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)

    fireEvent.click(workoutChoice("Спина"))

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(screen.getByText("1 / 21")).toBeInTheDocument()
    expect(workoutChoice("Спина")).toHaveAttribute("aria-checked", "true")
  })

  it("persists the new workout so a reload keeps it", () => {
    const first = render(<WorkoutTracker />)
    switchTo("Ноги")
    markSet(1, 2)
    expect(readStorage()?.workoutId).toBe("legs")
    first.unmount()

    render(<WorkoutTracker />)

    expect(screen.getByRole("heading", { level: 1, name: /Ноги/ })).toBeInTheDocument()
    expect(workoutChoice("Ноги")).toHaveAttribute("aria-checked", "true")
    expect(screen.getByText("1 / 21")).toBeInTheDocument()
    expect(setButton(1, 2)).toHaveAttribute("aria-pressed", "true")
  })

  it("keeps only one stored session", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)
    switchTo("Грудь")
    markSet(1, 1)

    expect(window.localStorage).toHaveLength(1)
    expect(readStorage()?.workoutId).toBe("push")
    expect(readStorage()?.completed).not.toHaveProperty("lat-pulldown-wide")
  })
})

describe("information dialog", () => {
  it("leaves no instructional prose on the page while closed", () => {
    render(<WorkoutTracker />)

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    for (const prose of [
      /Отмечай каждый выполненный подход/,
      /Через день по кругу/,
      /Таймер запускается автоматически/,
      /Данные хранятся только в этом браузере/,
      /Смена тренировки начинает выбранный день с нуля/,
    ]) {
      expect(screen.queryByText(prose)).not.toBeInTheDocument()
    }
  })

  it("opens from a 44 px labelled button and explains the current workout", () => {
    render(<WorkoutTracker />)

    const trigger = screen.getByRole("button", { name: "Информация о тренировке" })
    expect(trigger).toHaveClass("size-11")

    fireEvent.click(trigger)
    const dialog = screen.getByRole("dialog")

    expect(within(dialog).getByText("Информация о тренировке")).toBeInTheDocument()
    expect(within(dialog).getByText("Тренировка: Спина")).toBeInTheDocument()
    expect(within(dialog).getByText(/Отмечай каждый выполненный подход/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Таймер запускается автоматически/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Данные хранятся только в этом браузере/)).toBeInTheDocument()
    expect(within(dialog).getByText(/«Начать заново» сбрасывает текущую тренировку/)).toBeInTheDocument()
  })

  it("closes on the Закрыть button, returning focus, and leaves progress and the running rest alone", async () => {
    render(<WorkoutTracker />)
    markSet(1, 1)
    act(() => {
      vi.advanceTimersByTime(20_000)
    })
    expect(screen.getByText("Идёт отдых")).toBeInTheDocument()
    const saved = readStorage()

    const trigger = screen.getByRole("button", { name: "Информация о тренировке" })
    fireEvent.click(trigger)
    await act(async () => {
      closeInfo()
      // Radix restores focus asynchronously, so fake timers must run.
      await vi.advanceTimersByTimeAsync(100)
    })

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(screen.getByText("1 / 21")).toBeInTheDocument()
    expect(setButton(1, 1)).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText("Идёт отдых")).toBeInTheDocument()
    expect(timerDisplay()).toHaveTextContent("01:10")
    expect(readStorage()).toEqual(saved)
  })

  it("closes on Escape without touching the session", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)

    const dialog = openInfo()
    fireEvent.keyDown(dialog, { key: "Escape" })

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.getByText("1 / 21")).toBeInTheDocument()
    expect(screen.getByText("Идёт отдых")).toBeInTheDocument()
  })

  it("follows the selected workout", () => {
    render(<WorkoutTracker />)
    switchTo("Ноги")

    const dialog = openInfo()
    expect(within(dialog).getByText("Тренировка: Ноги")).toBeInTheDocument()
    expect(within(dialog).queryByText(/Спина/)).not.toBeInTheDocument()
  })
})

describe("marking sets", () => {
  it("updates aria-pressed, the per-exercise count and overall progress", () => {
    render(<WorkoutTracker />)

    const button = setButton(1, 1)
    expect(button).toHaveAttribute("aria-pressed", "false")

    markSet(1, 1)

    expect(setButton(1, 1)).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText("1 / 21")).toBeInTheDocument()
    expect(screen.getByText("5%")).toBeInTheDocument() // 1/21 = 4.76…
    expect(within(screen.getAllByRole("listitem")[0]).getByText("1/3")).toBeInTheDocument()
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

    expect(screen.getByText("21 / 21")).toBeInTheDocument()
    expect(screen.getByText("100%")).toBeInTheDocument()
    expect(screen.getByText(/Тренировка завершена — отмечены все 21 подходов/)).toBeInTheDocument()
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
  it("starts the alarm once when the rest ends naturally", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)

    act(() => {
      vi.advanceTimersByTime(89_000)
    })
    expect(startAlarm).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1_500)
    })
    expect(screen.getByText("Отдых завершён")).toBeInTheDocument()
    expect(timerDisplay()).toHaveTextContent("00:00")
    expect(startAlarm).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(startAlarm).toHaveBeenCalledTimes(1)
  })

  it("stays silent when the sound checkbox is off", () => {
    render(<WorkoutTracker />)
    fireEvent.click(screen.getByLabelText("Звуковой сигнал в конце отдыха"))
    markSet(1, 1)

    act(() => {
      vi.advanceTimersByTime(95_000)
    })
    expect(screen.getByText("Отдых завершён")).toBeInTheDocument()
    expect(startAlarm).not.toHaveBeenCalled()
  })

  it("finishes correctly after a long throttled gap", () => {
    render(<WorkoutTracker />)
    markSet(1, 1)

    act(() => {
      vi.advanceTimersByTime(10 * 60_000)
    })
    expect(screen.getByText("Отдых завершён")).toBeInTheDocument()
    expect(startAlarm).toHaveBeenCalledTimes(1)
  })
})

describe("alarm stop button", () => {
  /** Mark a set and let its rest run out, so the alarm is sounding. */
  function endRestNaturally() {
    markSet(1, 1)
    act(() => {
      vi.advanceTimersByTime(95_000)
    })
  }

  function stopButton(): HTMLElement | null {
    return screen.queryByRole("button", { name: STOP_ALARM_LABEL })
  }

  it("appears only once the alarm sounds and reports it to assistive tech", () => {
    render(<WorkoutTracker />)
    expect(stopButton()).not.toBeInTheDocument()

    markSet(1, 1)
    expect(stopButton()).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(95_000)
    })

    const button = stopButton()!
    expect(button).toBeInTheDocument()
    // 44px: the project's minimum comfortable touch target.
    expect(button).toHaveClass("h-11")
    const status = screen.getByText(/Сигнал звучит/)
    expect(status).toHaveAttribute("role", "status")
    expect(status).toHaveAttribute("aria-live", "assertive")
  })

  it("stays hidden when the alarm could not be played", () => {
    vi.mocked(startAlarm).mockReturnValueOnce(false)
    render(<WorkoutTracker />)
    endRestNaturally()

    expect(startAlarm).toHaveBeenCalledTimes(1)
    expect(stopButton()).not.toBeInTheDocument()
  })

  it("silences the alarm and dismisses itself when pressed", () => {
    render(<WorkoutTracker />)
    endRestNaturally()

    fireEvent.click(stopButton()!)

    expect(stopAlarm).toHaveBeenCalled()
    expect(stopButton()).not.toBeInTheDocument()
    // The finished rest itself is untouched: only the sound was dismissed.
    expect(screen.getByText("Отдых завершён")).toBeInTheDocument()
    expect(timerDisplay()).toHaveTextContent("00:00")
    // And it does not come back on later ticks.
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(stopButton()).not.toBeInTheDocument()
    expect(startAlarm).toHaveBeenCalledTimes(1)
  })

  it.each([
    ["marking the next set", () => markSet(1, 2)],
    ["skipping", () => fireEvent.click(screen.getByRole("button", { name: "Пропустить" }))],
    ["changing the preset", () => fireEvent.click(screen.getByRole("button", { name: "60 с" }))],
    [
      "unticking the sound checkbox",
      () => fireEvent.click(screen.getByLabelText("Звуковой сигнал в конце отдыха")),
    ],
    ["resetting", () => fireEvent.click(screen.getByRole("button", { name: "Начать заново" }))],
    ["switching workout", () => switchTo("Грудь")],
  ])("%s cancels the alarm", (_label, act_) => {
    render(<WorkoutTracker />)
    endRestNaturally()
    expect(stopButton()).toBeInTheDocument()

    vi.mocked(stopAlarm).mockClear()
    act_()

    expect(stopAlarm).toHaveBeenCalled()
    expect(stopButton()).not.toBeInTheDocument()
    expect(startAlarm).toHaveBeenCalledTimes(1)
  })

  it("cancels the alarm on unmount", () => {
    const view = render(<WorkoutTracker />)
    endRestNaturally()

    vi.mocked(stopAlarm).mockClear()
    view.unmount()

    expect(stopAlarm).toHaveBeenCalled()
  })

  it("does not sound again after a reload while the alarm was ringing", () => {
    const view = render(<WorkoutTracker />)
    endRestNaturally()
    expect(startAlarm).toHaveBeenCalledTimes(1)
    view.unmount()

    vi.mocked(startAlarm).mockClear()
    render(<WorkoutTracker />)

    expect(screen.getByText("Отдых завершён")).toBeInTheDocument()
    expect(startAlarm).not.toHaveBeenCalled()
    expect(stopButton()).not.toBeInTheDocument()
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

  it("round-trips marks, edits, preset and sound across a remount", () => {
    const first = render(<WorkoutTracker />)

    switchTo("Грудь")
    markSet(1, 1)
    markSet(7, 3)
    fireEvent.change(screen.getByLabelText(/Вес в кг, Жим на наклонной/), {
      target: { value: "20–25" },
    })
    fireEvent.change(screen.getByLabelText(/Количество повторений, Бабочка/), {
      target: { value: "8" },
    })
    fireEvent.click(screen.getByRole("button", { name: "120 с" }))
    fireEvent.click(screen.getByLabelText("Звуковой сигнал в конце отдыха"))
    fireEvent.click(screen.getByRole("button", { name: "Пропустить" }))

    expect(readStorage()?.version).toBe(3)
    first.unmount()

    render(<WorkoutTracker />)

    expect(workoutChoice("Грудь")).toHaveAttribute("aria-checked", "true")
    expect(setButton(1, 1)).toHaveAttribute("aria-pressed", "true")
    expect(setButton(7, 3)).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText("2 / 21")).toBeInTheDocument()
    expect(screen.getByLabelText(/Вес в кг, Жим на наклонной/)).toHaveValue("20–25")
    expect(screen.getByLabelText(/Количество повторений, Бабочка/)).toHaveValue("8")
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
    expect(startAlarm).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(timerDisplay()).toHaveTextContent("00:50")
  })

  it("restores an expired timer as finished without replaying the alarm", () => {
    seedStorage(savedSession("pull", "lat-pulldown-wide"))

    vi.setSystemTime(T0 + 10 * 60_000)
    render(<WorkoutTracker />)

    expect(screen.getByText("Отдых завершён")).toBeInTheDocument()
    expect(timerDisplay()).toHaveTextContent("00:00")
    expect(startAlarm).not.toHaveBeenCalled()
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
    window.localStorage.setItem(STORAGE_KEY, '{"version":3,"completed":')

    render(<WorkoutTracker />)

    expect(screen.getByText("0 / 21")).toBeInTheDocument()
    expect(workoutChoice("Спина")).toHaveAttribute("aria-checked", "true")
    expect(setButton(1, 1)).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByText("Готов к старту")).toBeInTheDocument()
  })

  it("falls back when the saved data uses an incompatible schema version", () => {
    const record = JSON.parse(serializeState(savedSession("push", "bench-press")))
    record.version = 99
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record))

    render(<WorkoutTracker />)
    expect(screen.getByText("0 / 21")).toBeInTheDocument()
    expect(workoutChoice("Спина")).toHaveAttribute("aria-checked", "true")
  })

  it("falls back when the saved data is the superseded v1 record", () => {
    // The oldest single-plan schema: no workout id, five exercises.
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

    expect(screen.getByRole("heading", { level: 1, name: /Спина/ })).toBeInTheDocument()
    expect(screen.getByText("0 / 21")).toBeInTheDocument()
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

    expect(screen.getByText("1 / 21")).toBeInTheDocument()
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

    expect(screen.getByText("0 / 21")).toBeInTheDocument()
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
    switchTo("Грудь")
    markSet(1, 1)

    fireEvent.click(screen.getByRole("button", { name: /Начать заново/ }))

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 1, name: /Грудь/ })).toBeInTheDocument()
    expect(screen.getByText("0 / 21")).toBeInTheDocument()
    // The selection itself is still worth remembering.
    expect(readStorage()?.workoutId).toBe("push")
  })

  it("leaves a fresh workout after a reload", () => {
    const first = render(<WorkoutTracker />)
    markSet(1, 1)
    fireEvent.click(screen.getByRole("button", { name: /Начать заново/ }))
    first.unmount()

    render(<WorkoutTracker />)
    expect(screen.getByText("0 / 21")).toBeInTheDocument()
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
    switchTo("Грудь")
    markSet(1, 1)
    fireEvent.change(screen.getByLabelText(/Вес в кг, Жим лёжа/), { target: { value: "15" } })

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Скопировать результаты/ }))
    })

    expect(writeText).toHaveBeenCalledTimes(1)
    const text = writeText.mock.calls[0][0] as string
    expect(text).toContain("Грудь")
    expect(text).toContain("1. Жим лёжа — 3 × 12–15 повт., вес 15 кг — выполнено 1/3")
    expect(text).toContain("Итого: 1 / 21 подходов (5%)")
    expect(text).not.toContain("Тяга верхнего блока")
    expect(screen.getByText(/Результаты скопированы/)).toBeInTheDocument()
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
    expect(text).toContain("Спина")
    expect(text).toContain("7. Гиперэкстензия на поясницу — 3 × 12–15 повт., вес не указан")
    expect(text).toContain("Итого: 0 / 21 подходов (0%)")
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
