import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WorkoutTracker } from "./workout-tracker"
import { startAlarm } from "@/lib/beep"

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
