import { fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WorkoutTracker } from "./workout-tracker"
import { stopAlarm } from "@/lib/beep"
import { SAVED_WORKOUTS_KEY, savedWorkouts, type SavedWorkout } from "@/lib/saved-workouts"
import { STORAGE_KEY, resetStorageHealthForTests } from "@/lib/workout-storage"

vi.mock("@/lib/beep", () => ({
  isAudioSupported: vi.fn(() => true),
  startAlarm: vi.fn(() => true),
  stopAlarm: vi.fn(),
  unlockAudio: vi.fn(),
  resetAudioForTests: vi.fn(),
}))

const T0 = 1_700_000_000_000

beforeEach(() => {
  // Radix's checkbox measures itself inside a <form>; jsdom has no ResizeObserver.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  window.localStorage.clear()
  resetStorageHealthForTests()
  vi.clearAllMocks()
  vi.useFakeTimers({ now: T0 })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const click = (name: string | RegExp, scope: HTMLElement = document.body) =>
  fireEvent.click(within(scope).getByRole("button", { name }))

const dialog = () => screen.getByRole("dialog")
const alertDialog = () => screen.getByRole("alertdialog")
const type = (label: string | RegExp, value: string, scope: HTMLElement = dialog()) =>
  fireEvent.change(within(scope).getByLabelText(label), { target: { value } })

function openLibrary() {
  click("Мои тренировки")
  return dialog()
}

function fillBasics(title = "Моя тренировка", label = "Моя") {
  type("Короткое название", label)
  type("Заголовок тренировки", title)
  type("Название упражнения 1", "Присед")
  type("Повторения 1", "8–10")
}

const catalog = () => {
  const result = savedWorkouts.list()
  if (!result.ok) throw new Error(result.error)
  return result.value
}

function seed(title = "Сохранённая"): SavedWorkout {
  const created = savedWorkouts.create({
    label: "С",
    title,
    restSeconds: 120,
    soundEnabled: false,
    exercises: [
      { id: "one", name: "Первое", sets: 2, reps: "10", weight: "20" },
      { id: "two", name: "Второе", sets: 3, setOptions: [2, 3], reps: "12", weight: "" },
    ],
  })
  if (!created.ok) throw new Error(created.error)
  return created.value
}

describe("library list states", () => {
  it("shows an empty state", () => {
    render(<WorkoutTracker />)
    openLibrary()
    expect(screen.getByText(/Пока нет сохранённых тренировок/)).toBeInTheDocument()
    expect(screen.getByText(/могут исчезнуть после очистки его данных/)).toBeInTheDocument()
  })

  it("shows an error, not an empty list, when the catalog is unreadable, and retries", () => {
    window.localStorage.setItem(SAVED_WORKOUTS_KEY, "{broken")
    render(<WorkoutTracker />)
    const library = openLibrary()
    expect(within(library).getByRole("alert")).toHaveTextContent(/повреждены/)
    expect(screen.queryByText(/Пока нет сохранённых/)).not.toBeInTheDocument()
    expect(within(library).getByRole("button", { name: "Новая пустая тренировка" })).toBeDisabled()

    window.localStorage.removeItem(SAVED_WORKOUTS_KEY)
    click("Повторить", library)
    expect(screen.getByText(/Пока нет сохранённых тренировок/)).toBeInTheDocument()
  })

  it("lists saved workouts", () => {
    seed("Ноги-2")
    render(<WorkoutTracker />)
    const library = openLibrary()
    expect(within(library).getByText("Ноги-2")).toBeInTheDocument()
    expect(within(library).getByText(/упражнений: 2/)).toBeInTheDocument()
  })
})

describe("create, edit, reload, launch", () => {
  it("creates a blank workout, shows it after reload and launches it with its values", () => {
    const first = render(<WorkoutTracker />)
    openLibrary()
    click("Новая пустая тренировка")
    fillBasics()
    type("Вес 1", "40")
    type("Подходы 1", "4")
    type(/Варианты подходов 1/, "3, 4")
    fireEvent.change(within(dialog()).getByLabelText("Отдых между подходами"), { target: { value: "180" } })
    fireEvent.click(within(dialog()).getByRole("checkbox"))
    click("Сохранить", dialog())

    expect(within(dialog()).getByRole("status")).toHaveTextContent("«Моя тренировка» сохранена")
    expect(catalog()[0]).toMatchObject({
      label: "Моя", title: "Моя тренировка", restSeconds: 180, soundEnabled: false,
      exercises: [{ name: "Присед", sets: 4, setOptions: [3, 4], reps: "8–10", weight: "40" }],
    })

    first.unmount()
    render(<WorkoutTracker />)
    openLibrary()
    expect(within(dialog()).getByText("Моя тренировка")).toBeInTheDocument()

    // Pristine default session: no confirmation needed.
    click("Запустить Моя тренировка", dialog())
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 1, name: /Моя тренировка/ })).toBeInTheDocument()
    expect(screen.getByText("0 / 4")).toBeInTheDocument()
    expect(screen.getByText("Присед", { exact: false })).toBeInTheDocument()
    const session = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)
    expect(session.workoutId).toBe(catalog()[0].id)
    expect(session.timer.durationSeconds).toBe(180)
    expect(session.soundEnabled).toBe(false)
  })

  it("edits an existing workout and keeps exercise ids", () => {
    const saved = seed()
    render(<WorkoutTracker />)
    openLibrary()
    click("Изменить Сохранённая", dialog())
    expect(within(dialog()).getByLabelText("Название упражнения 2")).toHaveValue("Второе")
    type("Заголовок тренировки", "Переименована")
    type("Название упражнения 1", "Новое")
    click("Сохранить", dialog())

    const [updated] = catalog()
    expect(updated.id).toBe(saved.id)
    expect(updated.title).toBe("Переименована")
    expect(updated.exercises.map((e) => [e.id, e.name])).toEqual([["one", "Новое"], ["two", "Второе"]])
  })

  it("reorders and removes exercises preserving ids", () => {
    seed()
    render(<WorkoutTracker />)
    openLibrary()
    click("Изменить Сохранённая", dialog())
    expect(within(dialog()).getByRole("button", { name: "Переместить упражнение 1 выше" })).toBeDisabled()
    click("Переместить упражнение 2 выше", dialog())
    expect(within(dialog()).getByLabelText("Название упражнения 1")).toHaveValue("Второе")
    click("Сохранить", dialog())
    expect(catalog()[0].exercises.map((e) => e.id)).toEqual(["two", "one"])

    click("Изменить Сохранённая", dialog())
    click("Удалить упражнение 1", dialog())
    expect(within(dialog()).queryByLabelText("Название упражнения 2")).not.toBeInTheDocument()
    click("Сохранить", dialog())
    expect(catalog()[0].exercises.map((e) => e.id)).toEqual(["one"])
  })

  it("adds an exercise with a new unique id", () => {
    seed()
    render(<WorkoutTracker />)
    openLibrary()
    click("Изменить Сохранённая", dialog())
    click("Добавить упражнение", dialog())
    type("Название упражнения 3", "Третье")
    type("Повторения 3", "5")
    click("Сохранить", dialog())
    const ids = catalog()[0].exercises.map((e) => e.id)
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3)
    expect(ids.slice(0, 2)).toEqual(["one", "two"])
  })

  it("copies a built-in workout independently", () => {
    render(<WorkoutTracker />)
    openLibrary()
    click("Копия встроенной: Грудь")
    expect(within(dialog()).getByLabelText("Заголовок тренировки")).toHaveValue("Грудь")
    expect(within(dialog()).getByLabelText("Название упражнения 1")).toHaveValue("Жим лёжа")
    type("Название упражнения 1", "Свой жим")
    click("Сохранить", dialog())
    expect(catalog()[0].exercises[0].name).toBe("Свой жим")
    expect(catalog()[0].exercises[0].id).not.toBe("bench-press")

    fireEvent.click(within(dialog()).getByRole("button", { name: "Закрыть" }))
    fireEvent.click(screen.getByRole("radio", { name: "Грудь" }))
    expect(within(alertDialog()).getByText(/Сменить тренировку на Грудь/)).toBeInTheDocument()
  })

  it("copies the current workout with edited values and a saved one independently", () => {
    const saved = seed()
    render(<WorkoutTracker />)
    fireEvent.change(screen.getAllByLabelText(/Количество повторений/)[0], { target: { value: "99" } })
    openLibrary()
    click("Копия текущей тренировки")
    expect(within(dialog()).getByLabelText("Название упражнения 1")).toHaveValue(
      "Тяга верхнего блока широким хватом"
    )
    expect(within(dialog()).getByLabelText("Повторения 1")).toHaveValue("99")
    click("Отмена", dialog())

    click("Копировать Сохранённая", dialog())
    type("Название упражнения 1", "Копия-упражнение")
    click("Сохранить", dialog())
    const all = catalog()
    expect(all).toHaveLength(2)
    expect(all.find((w) => w.id === saved.id)?.exercises[0].name).toBe("Первое")
    expect(all.find((w) => w.id !== saved.id)?.exercises[0].name).toBe("Копия-упражнение")
  })
})

describe("validation and failures", () => {
  it("shows field errors and does not save invalid input", () => {
    render(<WorkoutTracker />)
    openLibrary()
    click("Новая пустая тренировка")
    type("Подходы 1", "101")
    click("Сохранить", dialog())
    const editor = dialog()
    expect(within(editor).getByLabelText("Короткое название")).toHaveAttribute("aria-invalid", "true")
    expect(within(editor).getByLabelText("Подходы 1")).toHaveAccessibleDescription("Целое число от 1 до 100")
    expect(within(editor).getByRole("alert")).toHaveTextContent("Исправьте")
    expect(window.localStorage.getItem(SAVED_WORKOUTS_KEY)).toBeNull()

    type("Варианты подходов 1 (необязательно)", "2, 4")
    type("Подходы 1", "3")
    fillBasics()
    click("Сохранить", dialog())
    expect(within(dialog()).getByLabelText(/Варианты подходов 1/)).toHaveAccessibleDescription(
      "Варианты должны включать число подходов"
    )
  })

  it("keeps the draft and says so when the write fails", () => {
    render(<WorkoutTracker />)
    openLibrary()
    click("Новая пустая тренировка")
    fillBasics()
    const quota = Object.assign(new Error("full"), { name: "QuotaExceededError" })
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation((key) => {
      if (key === SAVED_WORKOUTS_KEY) throw quota
    })
    click("Сохранить", dialog())
    expect(within(dialog()).getByRole("alert")).toHaveTextContent(/Не удалось сохранить.*не хватает места/)
    expect(within(dialog()).getByLabelText("Заголовок тренировки")).toHaveValue("Моя тренировка")
    expect(within(dialog()).queryByRole("status")).not.toBeInTheDocument()

    spy.mockRestore()
    click("Сохранить", dialog())
    expect(catalog()).toHaveLength(1)
    expect(within(dialog()).getByRole("status")).toHaveTextContent("сохранена")
  })

  it("reports a failed delete", () => {
    seed()
    render(<WorkoutTracker />)
    openLibrary()
    click("Удалить Сохранённая", dialog())
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((key) => {
      if (key === SAVED_WORKOUTS_KEY) throw new Error("denied")
    })
    click("Удалить", alertDialog())
    expect(within(dialog()).getByRole("alert")).toHaveTextContent(/Не удалось удалить/)
    expect(within(dialog()).getByText("Сохранённая")).toBeInTheDocument()
  })
})

describe("dirty editor protection", () => {
  it("asks before discarding via Отмена and can keep editing", () => {
    render(<WorkoutTracker />)
    openLibrary()
    click("Новая пустая тренировка")
    type("Заголовок тренировки", "Черновик")
    click("Отмена", dialog())
    expect(within(alertDialog()).getByText("Отменить изменения?")).toBeInTheDocument()
    click("Продолжить редактирование", alertDialog())
    expect(within(dialog()).getByLabelText("Заголовок тренировки")).toHaveValue("Черновик")

    click("Отмена", dialog())
    click("Отменить изменения", alertDialog())
    expect(within(dialog()).getByText(/Пока нет сохранённых/)).toBeInTheDocument()
    expect(window.localStorage.getItem(SAVED_WORKOUTS_KEY)).toBeNull()
  })

  it("leaves a clean editor without a prompt", () => {
    render(<WorkoutTracker />)
    openLibrary()
    click("Новая пустая тренировка")
    click("Отмена", dialog())
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
  })

  it("guards Escape on a dirty editor", () => {
    render(<WorkoutTracker />)
    openLibrary()
    click("Новая пустая тренировка")
    type("Короткое название", "x")
    fireEvent.keyDown(dialog(), { key: "Escape" })
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
    click("Отменить изменения", alertDialog())
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("blocks unload only while the draft is dirty", () => {
    render(<WorkoutTracker />)
    const fire = () => {
      const event = new Event("beforeunload", { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }
    openLibrary()
    click("Новая пустая тренировка")
    expect(fire()).toBe(false)
    type("Короткое название", "x")
    expect(fire()).toBe(true)
    type("Короткое название", "")
    expect(fire()).toBe(false)
    type("Короткое название", "x")
    click("Отмена", dialog())
    click("Отменить изменения", alertDialog())
    expect(fire()).toBe(false)
  })
})

describe("delete", () => {
  it("needs confirmation and can be cancelled", () => {
    seed()
    render(<WorkoutTracker />)
    openLibrary()
    click("Удалить Сохранённая", dialog())
    click("Отмена", alertDialog())
    expect(catalog()).toHaveLength(1)

    click("Удалить Сохранённая", dialog())
    click("Удалить", alertDialog())
    expect(catalog()).toHaveLength(0)
    expect(within(dialog()).getByRole("status")).toHaveTextContent("удалена")
    expect(screen.getByText(/Пока нет сохранённых/)).toBeInTheDocument()
  })

  it("does not change a running session when its source is deleted", () => {
    const saved = seed()
    render(<WorkoutTracker />)
    openLibrary()
    click("Запустить Сохранённая", dialog())
    expect(screen.getByRole("heading", { level: 1, name: /Сохранённая/ })).toBeInTheDocument()

    openLibrary()
    expect(within(dialog()).getByText(/идёт сейчас/)).toBeInTheDocument()
    click("Удалить Сохранённая", dialog())
    click("Удалить", alertDialog())
    click("Закрыть", dialog())
    expect(screen.getByRole("heading", { level: 1, name: /Сохранённая/ })).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!).snapshot.id).toBe(saved.id)
  })
})

describe("launching", () => {
  it("confirms before replacing progress, then resets and silences the alarm", () => {
    seed()
    render(<WorkoutTracker />)
    fireEvent.click(screen.getAllByRole("button", { name: /подход 1:/i })[0])
    vi.mocked(stopAlarm).mockClear()

    openLibrary()
    click("Запустить Сохранённая", dialog())
    expect(within(alertDialog()).getByText(/прогресс.*будут сброшены/)).toBeInTheDocument()
    click("Отмена", alertDialog())
    expect(screen.getByText("1 / 21")).toBeInTheDocument()

    click("Запустить Сохранённая", dialog())
    click("Запустить", alertDialog())
    expect(stopAlarm).toHaveBeenCalled()
    expect(screen.getByRole("heading", { level: 1, name: /Сохранённая/ })).toBeInTheDocument()
    expect(screen.getByText("0 / 5")).toBeInTheDocument()
    expect(screen.getByRole("timer")).toHaveTextContent("02:00")
    expect(screen.getByRole("checkbox", { name: /Звуковой сигнал/ })).not.toBeChecked()
  })

  it("leaves no built-in selected while a saved workout runs", () => {
    seed()
    render(<WorkoutTracker />)
    openLibrary()
    click("Запустить Сохранённая", dialog())
    for (const name of ["Спина", "Грудь", "Ноги"]) {
      expect(screen.getByRole("radio", { name })).toHaveAttribute("aria-checked", "false")
    }
    expect(within(screen.getByRole("radiogroup", { name: "Тренировка" })).getAllByRole("radio")).toHaveLength(3)
  })

  it("restarts the same workout from its newest saved version after confirmation", () => {
    const saved = seed()
    render(<WorkoutTracker />)
    openLibrary()
    click("Запустить Сохранённая", dialog())
    fireEvent.click(screen.getAllByRole("button", { name: /подход 1:/i })[0])

    savedWorkouts.update(saved.id, { ...saved, title: "Обновлённая", restSeconds: 60 })
    openLibrary()
    // The running session still shows the old definition (page is aria-hidden behind the dialog).
    expect(screen.getByRole("heading", { level: 1, name: /Сохранённая/, hidden: true })).toBeInTheDocument()
    click("Запустить Обновлённая", dialog())
    expect(within(alertDialog()).getByText(/Перезапустить/)).toBeInTheDocument()
    click("Запустить", alertDialog())
    expect(screen.getByRole("heading", { level: 1, name: /Обновлённая/ })).toBeInTheDocument()
    expect(screen.getByText("0 / 5")).toBeInTheDocument()
    expect(screen.getByRole("timer")).toHaveTextContent("01:00")
  })

  it("uses the newest version even if the catalog changed behind an open list", () => {
    const saved = seed()
    render(<WorkoutTracker />)
    openLibrary()
    savedWorkouts.update(saved.id, { ...saved, title: "Свежая" })
    click("Запустить Сохранённая", dialog())
    expect(screen.getByRole("heading", { level: 1, name: /Свежая/ })).toBeInTheDocument()
  })

  it("reports when the workout vanished before launch and keeps the session", () => {
    const saved = seed()
    render(<WorkoutTracker />)
    openLibrary()
    savedWorkouts.remove(saved.id)
    click("Запустить Сохранённая", dialog())
    expect(within(dialog()).getByRole("alert")).toHaveTextContent(/не найдена/)
    expect(screen.getByRole("heading", { level: 1, name: /Спина/, hidden: true })).toBeInTheDocument()
  })

  it("restores a launched workout after reload without the catalog", () => {
    const saved = seed()
    const first = render(<WorkoutTracker />)
    openLibrary()
    click("Запустить Сохранённая", dialog())
    savedWorkouts.remove(saved.id)
    first.unmount()
    render(<WorkoutTracker />)
    expect(screen.getByRole("heading", { level: 1, name: /Сохранённая/ })).toBeInTheDocument()
    expect(screen.getByText("0 / 5")).toBeInTheDocument()
  })
})

describe("mobile layout hooks", () => {
  it("gives the library and editor controls 44px targets and labelled inputs", () => {
    seed()
    render(<WorkoutTracker />)
    openLibrary()
    for (const button of within(dialog()).getAllByRole("button")) {
      expect(button.className).toMatch(/\b(h-11|size-11|min-h-11)\b/)
    }
    click("Изменить Сохранённая", dialog())
    for (const input of within(dialog()).getAllByRole("textbox")) {
      expect(input).toHaveAccessibleName()
      expect(input.className).toMatch(/\bh-11\b/)
      expect(input.className).toMatch(/\bw-full\b/)
    }
  })
})
