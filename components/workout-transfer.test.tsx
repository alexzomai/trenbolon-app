import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WorkoutTracker } from "./workout-tracker"
import { SAVED_WORKOUTS_KEY, savedWorkouts } from "@/lib/saved-workouts"
import { STORAGE_KEY, resetStorageHealthForTests } from "@/lib/workout-storage"
import { AI_PROMPT, SAMPLE_JSON, buildExportJson } from "@/lib/workout-transfer"

vi.mock("@/lib/beep", () => ({
  isAudioSupported: vi.fn(() => true),
  startAlarm: vi.fn(() => true),
  stopAlarm: vi.fn(),
  unlockAudio: vi.fn(),
  resetAudioForTests: vi.fn(),
}))

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  window.localStorage.clear()
  resetStorageHealthForTests()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const dialog = () => screen.getByRole("dialog")
const click = (name: string | RegExp) => fireEvent.click(within(dialog()).getByRole("button", { name }))
const paste = (value: string) => fireEvent.change(within(dialog()).getByLabelText("Или вставьте JSON"), { target: { value } })
const catalog = () => {
  const r = savedWorkouts.list()
  if (!r.ok) throw new Error(r.error)
  return r.value
}
function open() {
  fireEvent.click(screen.getByRole("button", { name: "Мои тренировки" }))
  click("Импорт / экспорт")
}
const seed = () => {
  const r = savedWorkouts.create({
    label: "С", title: "Старая", restSeconds: 60, soundEnabled: true,
    exercises: [{ id: "a", name: "Тяга", sets: 2, setOptions: [2, 3], reps: "8", weight: "5" }],
  })
  if (!r.ok) throw new Error(r.error)
  return r.value
}

describe("import UI", () => {
  it("previews, then appends only on explicit import", () => {
    const old = seed()
    render(<WorkoutTracker />)
    open()
    paste(SAMPLE_JSON)
    expect(within(dialog()).queryByRole("button", { name: "Импортировать" })).not.toBeInTheDocument()
    click("Проверить")
    expect(within(dialog()).getByRole("status")).toHaveTextContent("Будет добавлено тренировок: 1")
    expect(within(dialog()).getByLabelText("Предпросмотр импорта")).toHaveTextContent("Плечи и руки")
    expect(catalog()).toHaveLength(1)

    click("Импортировать")
    expect(catalog()).toHaveLength(2)
    expect(catalog()[0]).toEqual(old)
    expect(catalog()[1].id).not.toBe(old.id)
    expect(within(dialog()).getByRole("status")).toHaveTextContent("Импортировано тренировок: 1")
    expect(within(dialog()).getByText("Плечи и руки")).toBeInTheDocument()
  })

  it("shows Russian field errors and imports nothing for an invalid batch", () => {
    render(<WorkoutTracker />)
    open()
    const bad = JSON.parse(SAMPLE_JSON)
    bad.workouts.push({ ...bad.workouts[0], restSeconds: 0 })
    paste(JSON.stringify(bad))
    click("Проверить")
    expect(within(dialog()).getByRole("alert")).toHaveTextContent("Тренировка 2: поле «restSeconds»")
    expect(within(dialog()).queryByRole("button", { name: "Импортировать" })).not.toBeInTheDocument()
    expect(window.localStorage.getItem(SAVED_WORKOUTS_KEY)).toBeNull()
  })

  it("drops a stale preview when the text is edited", () => {
    render(<WorkoutTracker />)
    open()
    paste(SAMPLE_JSON)
    click("Проверить")
    paste(SAMPLE_JSON + " ")
    expect(within(dialog()).queryByRole("button", { name: "Импортировать" })).not.toBeInTheDocument()
  })

  it("reads an uploaded file and validates it", async () => {
    render(<WorkoutTracker />)
    open()
    const file = new File([SAMPLE_JSON], "w.json", { type: "application/json" })
    await act(async () => {
      fireEvent.change(within(dialog()).getByLabelText("Файл JSON"), { target: { files: [file] } })
    })
    await waitFor(() => expect(within(dialog()).getByRole("status")).toHaveTextContent("Проверка пройдена"))
    expect(within(dialog()).getByLabelText("Или вставьте JSON")).toHaveValue(SAMPLE_JSON)
  })

  it("rejects an oversized file without reading it", async () => {
    render(<WorkoutTracker />)
    open()
    const file = new File(["x"], "big.json")
    Object.defineProperty(file, "size", { value: 50_000_000 })
    const read = vi.spyOn(file, "text")
    await act(async () => {
      fireEvent.change(within(dialog()).getByLabelText("Файл JSON"), { target: { files: [file] } })
    })
    expect(within(dialog()).getByRole("alert")).toHaveTextContent("слишком большой")
    expect(read).not.toHaveBeenCalled()
  })

  it("honestly reports a storage failure and keeps the preview, catalog and session", () => {
    const old = seed()
    render(<WorkoutTracker />)
    const session = window.localStorage.getItem(STORAGE_KEY)
    open()
    paste(SAMPLE_JSON)
    click("Проверить")
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError")
    })
    click("Импортировать")
    expect(within(dialog()).getByText(/Ничего не добавлено: В хранилище браузера не хватает места/)).toBeInTheDocument()
    expect(within(dialog()).queryByText(/Импортировано/)).not.toBeInTheDocument()
    spy.mockRestore()
    expect(catalog()).toEqual([old])
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(session)
  })

  it("leaves the active session untouched", () => {
    const old = seed()
    render(<WorkoutTracker />)
    fireEvent.click(screen.getByRole("button", { name: "Мои тренировки" }))
    fireEvent.click(within(dialog()).getByRole("button", { name: `Запустить ${old.title}` }))
    const session = window.localStorage.getItem(STORAGE_KEY)
    expect(session).toContain(old.id)
    open()
    paste(SAMPLE_JSON)
    click("Проверить")
    click("Импортировать")
    expect(catalog()).toHaveLength(2)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(session)
  })
})

describe("export UI", () => {
  it("exports the catalog without ids, copyable and downloadable", async () => {
    const old = seed()
    render(<WorkoutTracker />)
    open()
    const area = within(dialog()).getByLabelText("JSON сохранённых тренировок") as HTMLTextAreaElement
    expect(area.value).toBe(buildExportJson([old]))
    expect(area.value).not.toContain("user:")
    expect(area.value).not.toContain('"id"')

    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } })
    await act(async () => click("Копировать JSON"))
    expect(writeText).toHaveBeenCalledWith(area.value)

    const create = vi.fn(() => "blob:x")
    const revoke = vi.fn()
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke })
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    click("Скачать JSON")
    expect(create).toHaveBeenCalledTimes(1)
    expect(anchorClick).toHaveBeenCalled()
  })

  it("says so when copying is impossible, and shows empty export state", async () => {
    render(<WorkoutTracker />)
    open()
    expect(within(dialog()).getByText(/Нет сохранённых тренировок для экспорта/)).toBeInTheDocument()
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined })
    await act(async () => click("Копировать инструкцию для ИИ"))
    expect(within(dialog()).getByRole("alert")).toHaveTextContent("Не удалось скопировать")
  })

  it("offers the AI prompt, sample and schema links", async () => {
    render(<WorkoutTracker />)
    open()
    expect((within(dialog()).getByLabelText("Инструкция для ИИ") as HTMLTextAreaElement).value).toBe(AI_PROMPT)
    expect((within(dialog()).getByLabelText("Пример JSON") as HTMLTextAreaElement).value).toBe(SAMPLE_JSON)
    expect(within(dialog()).getByRole("link", { name: "JSON Schema" })).toHaveAttribute("href", "/workout-import.schema.json")
    click("Вставить пример")
    expect(within(dialog()).getByLabelText("Или вставьте JSON")).toHaveValue(SAMPLE_JSON)
    click("Назад к списку")
    expect(within(dialog()).getByRole("button", { name: "Импорт / экспорт" })).toBeInTheDocument()
  })
})
