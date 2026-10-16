/**
 * Covers the server-render → hydrate path that `render()` from Testing Library
 * never exercises: a client render reports `useIsHydrated() === true` on its
 * very first pass, so only a real `hydrateRoot` can show that the prerendered
 * markup matches and that the server-rendered instance does not touch storage
 * before the client instance has read it.
 */

import { act } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"

import { WorkoutTracker } from "./workout-tracker"
import { createInitialState, workoutReducer } from "@/lib/workout-state"
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

/** A saved Push session with one set marked and a rest running since T0. */
function savedWorkout() {
  return workoutReducer(createInitialState("push"), {
    type: "toggle-set",
    exerciseId: "bench-press",
    setIndex: 0,
    now: T0,
  })
}

let container: HTMLDivElement | null = null

beforeEach(() => {
  window.localStorage.clear()
  resetStorageHealthForTests()
  vi.clearAllMocks()
  vi.useFakeTimers({ now: T0 })
})

afterEach(() => {
  container?.remove()
  container = null
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Rendered text with React's comment separators collapsed away. */
function renderToText(): string {
  const host = document.createElement("div")
  host.innerHTML = renderToString(<WorkoutTracker />)
  return host.textContent ?? ""
}

describe("server rendering", () => {
  it("renders the default workout without reading storage", () => {
    window.localStorage.setItem(STORAGE_KEY, serializeState(savedWorkout()))

    const text = renderToText()

    expect(text).toContain("День 1 — Pull")
    expect(text).toContain("0 / 19")
    expect(text).toContain("01:30")
    expect(text).toContain("Готов к старту")
    // The saved session must not leak into the prerendered markup.
    expect(text).not.toContain("День 2 — Push")
    expect(text).not.toContain("1 / 18")
  })

  it("does not warn about missing storage in the prerendered markup", () => {
    expect(renderToText()).not.toContain("Браузер запретил локальное хранилище")
  })

  it("prerenders no confirmation dialog", () => {
    expect(renderToText()).not.toContain("будут сброшены")
  })
})

describe("hydration", () => {
  async function hydrate() {
    const html = renderToString(<WorkoutTracker />)
    container = document.createElement("div")
    container.innerHTML = html
    document.body.appendChild(container)

    await act(async () => {
      hydrateRoot(container!, <WorkoutTracker />)
    })
    return container
  }

  it("hydrates the prerendered markup without a mismatch", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})

    await hydrate()

    const messages = errors.mock.calls.map((call) => String(call[0])).join("\n")
    expect(messages).not.toMatch(/hydrat/i)
  })

  it("shows the saved workout once the client takes over", async () => {
    window.localStorage.setItem(STORAGE_KEY, serializeState(savedWorkout()))
    const before = window.localStorage.getItem(STORAGE_KEY)

    // Page reopened 30 s into the rest.
    vi.setSystemTime(T0 + 30_000)
    const root = await hydrate()

    expect(root.textContent).toContain("День 2 — Push")
    expect(root.textContent).toContain("1 / 18")
    expect(root.textContent).toContain("6%")
    expect(root.textContent).toContain("Идёт отдых")
    expect(root.textContent).toContain("01:00")

    // The server-rendered pass must not have clobbered the record.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(before)
  })

  it("leaves a fresh workout alone and writes nothing", async () => {
    const root = await hydrate()

    expect(root.textContent).toContain("День 1 — Pull")
    expect(root.textContent).toContain("0 / 19")
    expect(root.textContent).toContain("Готов к старту")
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})
