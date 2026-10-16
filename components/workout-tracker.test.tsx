import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WorkoutTracker } from "./workout-tracker"
import { playBeep, unlockAudio } from "@/lib/beep"
import { EXERCISES } from "@/lib/workout-plan"
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

function seedStorage(state: WorkoutState) {
  window.localStorage.setItem(STORAGE_KEY, serializeState(state))
}

function readStorage() {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  return raw === null ? null : JSON.parse(raw)
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
  it("shows the heading, every exercise and all 15 set buttons", () => {
    render(<WorkoutTracker />)

    expect(
      screen.getByRole("heading", { level: 1, name: /Тренировка: грудь и плечи/ })
    ).toBeInTheDocument()

    for (const [index, exercise] of EXERCISES.entries()) {
      expect(
        screen.getByText(`${index + 1}. ${exercise.name}`, { exact: false })
      ).toBeInTheDocument()
    }

    expect(screen.getAllByRole("button", { name: /подход \d:/i })).toHaveLength(15)
    expect(screen.getByText("0 / 15")).toBeInTheDocument()
    expect(screen.getByText("0%")).toBeInTheDocument()
  })

  it("seeds the editable weight and reps fields from the plan", () => {
    render(<WorkoutTracker />)

    expect(screen.getByLabelText(/Вес в кг, Жим лёжа/)).toHaveValue("10–13")
    expect(screen.getByLabelText(/Вес в кг, Жим на наклонной/)).toHaveValue("")
    expect(screen.getByLabelText(/Количество повторений, Бабочка/)).toHaveValue("10–12")
    expect(screen.getByLabelText(/Вес в кг, Бабочка/)).toHaveValue("42–45")
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

describe("marking sets", () => {
  it("updates aria-pressed, the per-exercise count and overall progress", () => {
    render(<WorkoutTracker />)

    const button = setButton(1, 1)
    expect(button).toHaveAttribute("aria-pressed", "false")

    markSet(1, 1)

    expect(setButton(1, 1)).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText("1 / 15")).toBeInTheDocument()
    expect(screen.getByText("7%")).toBeInTheDocument()
    expect(
      within(screen.getAllByRole("listitem")[0]).getByText("1/3")
    ).toBeInTheDocument()
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

    for (const [exerciseIndex] of EXERCISES.entries()) {
      for (let setNumber = 1; setNumber <= 3; setNumber += 1) {
        markSet(exerciseIndex + 1, setNumber)
      }
    }

    expect(screen.getByText("15 / 15")).toBeInTheDocument()
    expect(screen.getByText("100%")).toBeInTheDocument()
    expect(screen.getByText(/Тренировка завершена/)).toBeInTheDocument()
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

    expect(screen.getByRole("button", { name: "90 с" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )

    fireEvent.click(screen.getByRole("button", { name: "120 с" }))
    expect(screen.getByRole("button", { name: "120 с" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    expect(screen.getByRole("button", { name: "90 с" })).toHaveAttribute(
      "aria-pressed",
      "false"
    )
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

    const weight = screen.getByLabelText(/Вес в кг, Жим на наклонной/)
    fireEvent.change(weight, { target: { value: "20–25" } })
    expect(weight).toHaveValue("20–25")

    const reps = screen.getByLabelText(/Количество повторений, Жим на наклонной/)
    fireEvent.change(reps, { target: { value: "6–8" } })
    expect(
      within(screen.getAllByRole("listitem")[1]).getByText("3 × 6–8")
    ).toBeInTheDocument()
  })
})

describe("persistence", () => {
  it("writes nothing on first mount so saved state is never overwritten", () => {
    const saved = workoutReducer(createInitialState(), {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 0,
      now: T0,
    })
    seedStorage(saved)
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

    markSet(1, 1)
    markSet(5, 3)
    fireEvent.change(screen.getByLabelText(/Вес в кг, Жим на наклонной/), {
      target: { value: "20–25" },
    })
    fireEvent.change(screen.getByLabelText(/Количество повторений, Бабочка/), {
      target: { value: "8" },
    })
    fireEvent.click(screen.getByRole("button", { name: "120 с" }))
    fireEvent.click(screen.getByLabelText("Звуковой сигнал в конце отдыха"))
    fireEvent.click(screen.getByRole("button", { name: "Пропустить" }))

    expect(readStorage()?.version).toBe(1)
    first.unmount()

    render(<WorkoutTracker />)

    expect(setButton(1, 1)).toHaveAttribute("aria-pressed", "true")
    expect(setButton(5, 3)).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText("2 / 15")).toBeInTheDocument()
    expect(screen.getByLabelText(/Вес в кг, Жим на наклонной/)).toHaveValue("20–25")
    expect(screen.getByLabelText(/Количество повторений, Бабочка/)).toHaveValue("8")
    expect(screen.getByRole("button", { name: "120 с" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    expect(screen.getByLabelText("Звуковой сигнал в конце отдыха")).toHaveAttribute(
      "aria-checked",
      "false"
    )
  })

  it("restores a running timer with the time that actually remains", () => {
    const running = workoutReducer(createInitialState(), {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 0,
      now: T0,
    })
    seedStorage(running)

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
    const running = workoutReducer(createInitialState(), {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 0,
      now: T0,
    })
    seedStorage(running)

    vi.setSystemTime(T0 + 10 * 60_000)
    render(<WorkoutTracker />)

    expect(screen.getByText("Отдых завершён")).toBeInTheDocument()
    expect(timerDisplay()).toHaveTextContent("00:00")
    expect(playBeep).not.toHaveBeenCalled()
  })

  it("restores a paused timer with its frozen remainder", () => {
    let paused = workoutReducer(createInitialState(), {
      type: "toggle-set",
      exerciseId: "bench-press",
      setIndex: 0,
      now: T0,
    })
    paused = workoutReducer(paused, { type: "pause", now: T0 + 25_000 })
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
    window.localStorage.setItem(STORAGE_KEY, '{"version":1,"completed":')

    render(<WorkoutTracker />)

    expect(screen.getByText("0 / 15")).toBeInTheDocument()
    expect(setButton(1, 1)).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByLabelText(/Вес в кг, Жим лёжа/)).toHaveValue("10–13")
    expect(screen.getByText("Готов к старту")).toBeInTheDocument()
  })

  it("falls back when the saved data uses an incompatible schema version", () => {
    const record = JSON.parse(serializeState(createInitialState()))
    record.version = 99
    record.completed["bench-press"] = [true, true, true]
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record))

    render(<WorkoutTracker />)
    expect(screen.getByText("0 / 15")).toBeInTheDocument()
  })

  it("keeps working and warns when localStorage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError")
    })

    render(<WorkoutTracker />)
    markSet(1, 1)

    expect(screen.getByText("1 / 15")).toBeInTheDocument()
    expect(screen.getByText(/Браузер запретил локальное хранилище/)).toBeInTheDocument()
  })
})

describe("reset", () => {
  it("clears marks, edits, timer and the saved record", () => {
    render(<WorkoutTracker />)

    markSet(1, 1)
    markSet(2, 2)
    fireEvent.change(screen.getByLabelText(/Вес в кг, Жим на наклонной/), {
      target: { value: "99" },
    })
    fireEvent.click(screen.getByRole("button", { name: "180 с" }))
    fireEvent.click(screen.getByLabelText("Звуковой сигнал в конце отдыха"))
    expect(readStorage()).not.toBeNull()

    fireEvent.click(screen.getByRole("button", { name: /Начать заново/ }))

    expect(screen.getByText("0 / 15")).toBeInTheDocument()
    expect(screen.getByText("0%")).toBeInTheDocument()
    expect(setButton(1, 1)).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByLabelText(/Вес в кг, Жим на наклонной/)).toHaveValue("")
    expect(screen.getByRole("button", { name: "90 с" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    expect(screen.getByLabelText("Звуковой сигнал в конце отдыха")).toHaveAttribute(
      "aria-checked",
      "true"
    )
    expect(screen.getByText("Готов к старту")).toBeInTheDocument()
    expect(readStorage()).toBeNull()
  })

  it("leaves a fresh workout after a reload", () => {
    const first = render(<WorkoutTracker />)
    markSet(1, 1)
    fireEvent.click(screen.getByRole("button", { name: /Начать заново/ }))
    first.unmount()

    render(<WorkoutTracker />)
    expect(screen.getByText("0 / 15")).toBeInTheDocument()
  })
})

describe("copying results", () => {
  it("copies the live state and confirms success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    })

    render(<WorkoutTracker />)
    markSet(1, 1)
    fireEvent.change(screen.getByLabelText(/Вес в кг, Жим лёжа/), {
      target: { value: "15" },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Скопировать результаты/ }))
    })

    expect(writeText).toHaveBeenCalledTimes(1)
    const text = writeText.mock.calls[0][0] as string
    expect(text).toContain("1. Жим лёжа — 3 × 8–10 повт., вес 15 кг — выполнено 1/3")
    expect(text).toContain("Итого: 1 / 15 подходов (7%)")
    expect(screen.getByText(/Результаты скопированы/)).toBeInTheDocument()
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
