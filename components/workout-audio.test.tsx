import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WorkoutTracker } from "./workout-tracker"
import { startAlarm } from "@/lib/beep"
import { savedWorkouts } from "@/lib/saved-workouts"
import { STORAGE_KEY } from "@/lib/workout-storage"

vi.mock("@/lib/beep", () => ({
  isAudioSupported: () => true, startAlarm: vi.fn(() => true), stopAlarm: vi.fn(), unlockAudio: vi.fn(),
}))
class Media {
  static instances: Media[] = []
  static reject = false
  currentTime = 0
  paused = false
  ended = false
  onpause: (() => void) | null = null
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeupdate: (() => void) | null = null
  play = vi.fn(() => Media.reject ? Promise.reject(new Error("blocked")) : Promise.resolve())
  pause = vi.fn(() => { this.paused = true })
  load = vi.fn()
  removeAttribute = vi.fn()
  constructor() { Media.instances.push(this) }
}
function mark(index = 0) {
  fireEvent.click(within(screen.getAllByRole("listitem")[0]).getByRole("button", {
    name: new RegExp(`подход ${index + 1}:`, "i"),
  }))
}
async function settle() { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
beforeEach(() => {
  window.localStorage.clear()
  vi.clearAllMocks()
  vi.useFakeTimers({ now: 100_000 })
  Media.instances = []; Media.reject = false
  vi.stubGlobal("Audio", Media)
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test")
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe("media + workout integration", () => {
  it("keeps a saved session and its audio independent of catalog edits/deletion, then reloads", async () => {
    const result = savedWorkouts.create({
      label: "Тест", title: "Сохранённая", restSeconds: 120, soundEnabled: true,
      exercises: [{ id: "one", name: "Присед", sets: 2, reps: "10", weight: "40" }],
    })
    if (!result.ok) throw new Error(result.error)
    const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }))
    const view = render(<WorkoutTracker />)
    click("Мои тренировки"); click("Запустить Сохранённая")
    mark(); await settle()
    const deadline = JSON.parse(localStorage.getItem(STORAGE_KEY)!).timer.deadline
    const updated = savedWorkouts.update(result.value.id, { ...result.value, title: "Новая", restSeconds: 60 })
    expect(updated.ok).toBe(true)
    click("Мои тренировки"); click("Закрыть")
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Сохранённая")
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).timer.deadline).toBe(deadline)
    expect(Media.instances).toHaveLength(1)
    expect(Media.instances[0].pause).not.toHaveBeenCalled()
    expect(savedWorkouts.remove(result.value.id).ok).toBe(true)
    click("Мои тренировки"); click("Закрыть")
    expect(screen.getByText("1 / 2")).toBeInTheDocument()
    view.unmount()
    expect(Media.instances[0].pause).toHaveBeenCalledOnce()
    render(<WorkoutTracker />)
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Сохранённая")
    expect(screen.getByText("1 / 2")).toBeInTheDocument()
    expect(Media.instances).toHaveLength(1) // reload never auto-plays media
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).timer.deadline).toBe(deadline)
  })
  it("relaunches a saved workout without leaving old media or duplicate clocks", async () => {
    const result = savedWorkouts.create({
      label: "Тест", title: "Сохранённая", restSeconds: 60, soundEnabled: true,
      exercises: [{ id: "one", name: "Присед", sets: 2, reps: "10", weight: "40" }],
    })
    if (!result.ok) throw new Error(result.error)
    const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }))
    render(<WorkoutTracker />)
    click("Мои тренировки"); click("Запустить Сохранённая")
    mark(); await settle()
    click("Мои тренировки"); click("Запустить Сохранённая")
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Запустить" }))
    expect(Media.instances[0].pause).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce()
    expect(screen.getByRole("timer")).toHaveTextContent("01:00")
    expect(screen.getByText("0 / 2")).toBeInTheDocument()
    mark(); await settle()
    expect(Media.instances).toHaveLength(2)
    expect(Media.instances[1].play).toHaveBeenCalledOnce()
    Media.instances[1].currentTime = 1
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByRole("timer")).toHaveTextContent("00:59")
    expect(startAlarm).not.toHaveBeenCalled()
  })
  it("starts during a click, pauses/releases, resumes with a fresh timeline", async () => {
    render(<WorkoutTracker />)
    mark()
    expect(Media.instances[0].play).toHaveBeenCalledOnce()
    await settle()
    vi.setSystemTime(110_000); Media.instances[0].currentTime = 10
    fireEvent.click(screen.getByRole("button", { name: "Пауза" }))
    expect(Media.instances[0].pause).toHaveBeenCalledOnce()
    expect(screen.getByRole("timer")).toHaveTextContent("01:20")
    vi.setSystemTime(150_000)
    fireEvent.click(screen.getByRole("button", { name: "Продолжить" }))
    expect(Media.instances).toHaveLength(2)
    await settle()
    vi.setSystemTime(230_000); Media.instances[1].currentTime = 80
    act(() => { window.dispatchEvent(new Event("focus")) })
    expect(screen.getByRole("button", { name: "Остановить сигнал" })).toBeInTheDocument()
    expect(startAlarm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Остановить сигнал" }))
    expect(Media.instances[1].pause).toHaveBeenCalledOnce()
  })
  it("does not replay stale audio after JS and decoder were suspended", async () => {
    render(<WorkoutTracker />); mark(); await settle()
    vi.setSystemTime(400_000)
    act(() => { document.dispatchEvent(new Event("visibilitychange")) })
    expect(screen.getByText("Отдых завершён")).toBeInTheDocument()
    expect(startAlarm).not.toHaveBeenCalled()
    expect(screen.queryByRole("button", { name: "Остановить сигнал" })).not.toBeInTheDocument()
    expect(Media.instances[0].pause).toHaveBeenCalledOnce()
    expect(screen.getByRole("alert")).toHaveTextContent("Браузер остановил звук")
  })
  it("shows a current media alarm even if the JS tick missed the deadline", async () => {
    render(<WorkoutTracker />); mark(); await settle()
    vi.setSystemTime(195_000); Media.instances[0].currentTime = 95
    act(() => { window.dispatchEvent(new Event("pageshow")) })
    expect(screen.getByRole("button", { name: "Остановить сигнал" })).toBeInTheDocument()
    expect(startAlarm).not.toHaveBeenCalled()
    act(() => { Media.instances[0].onended?.() })
    expect(screen.queryByRole("button", { name: "Остановить сигнал" })).not.toBeInTheDocument()
  })
  it("reports play rejection without claiming the timer stopped", async () => {
    Media.reject = true
    render(<WorkoutTracker />); mark(); await settle()
    expect(screen.getByRole("alert")).toHaveTextContent("Таймер продолжает идти")
    expect(screen.getByText("Идёт отдых")).toBeInTheDocument()
  })
  it("replaces on next set, stops on mute/skip/reset and cleans up on unmount", async () => {
    const view = render(<WorkoutTracker />); mark(); await settle()
    mark(1); await settle()
    expect(Media.instances).toHaveLength(2)
    expect(Media.instances[0].pause).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByLabelText("Звуковой сигнал в конце отдыха"))
    expect(Media.instances[1].pause).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByLabelText("Звуковой сигнал в конце отдыха")); await settle()
    fireEvent.click(screen.getByRole("button", { name: "Пропустить" }))
    expect(Media.instances[2].pause).toHaveBeenCalledOnce()
    mark(2); await settle()
    fireEvent.click(screen.getByRole("button", { name: "Начать заново" }))
    expect(Media.instances[3].pause).toHaveBeenCalledOnce()
    mark(); await settle(); view.unmount()
    expect(Media.instances[4].pause).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(5)
  })
})
