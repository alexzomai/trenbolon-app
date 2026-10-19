import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  SAVED_WORKOUTS_KEY, createWorkoutRepository, draftFromWorkout, type StorageResult,
} from "./saved-workouts"
import { WORKOUTS } from "./workout-plan"
import { STORAGE_KEY } from "./workout-storage"

function value<T>(result: StorageResult<T>): T {
  if (!result.ok) throw new Error(result.error)
  return result.value
}
const draft = (title = "Т") => ({ ...draftFromWorkout(WORKOUTS.pull), title })
beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe("importDrafts", () => {
  it("appends with new IDs, keeps existing workouts and persists across repositories", () => {
    const repo = createWorkoutRepository()
    const existing = value(repo.create(draft("Старая")))
    const added = value(repo.importDrafts([draft("А"), draft("Б")]))
    expect(added.map((w) => w.title)).toEqual(["А", "Б"])
    expect(new Set([existing.id, ...added.map((w) => w.id)]).size).toBe(3)
    expect(value(createWorkoutRepository().list())).toEqual([existing, ...added])
  })

  it("rejects an invalid batch without touching storage", () => {
    const repo = createWorkoutRepository()
    value(repo.create(draft("Старая")))
    const before = localStorage.getItem(SAVED_WORKOUTS_KEY)
    const bad = { ...draft("Плохая"), restSeconds: 0 }
    expect(repo.importDrafts([draft("Ок"), bad])).toEqual({ ok: false, error: "invalid" })
    expect(repo.importDrafts([])).toEqual({ ok: false, error: "invalid" })
    expect(localStorage.getItem(SAVED_WORKOUTS_KEY)).toBe(before)
  })

  it("keeps old data and reports quota / write failures", () => {
    const repo = createWorkoutRepository()
    value(repo.create(draft("Старая")))
    const before = localStorage.getItem(SAVED_WORKOUTS_KEY)
    for (const [name, error] of [["QuotaExceededError", "quota"], ["Other", "write-failed"]] as const) {
      const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("x", name) })
      expect(repo.importDrafts([draft()])).toEqual({ ok: false, error })
      spy.mockRestore()
    }
    expect(localStorage.getItem(SAVED_WORKOUTS_KEY)).toBe(before)
  })

  it("does not overwrite corrupt data, and reports unavailable storage", () => {
    localStorage.setItem(SAVED_WORKOUTS_KEY, "{broken")
    expect(createWorkoutRepository().importDrafts([draft()])).toEqual({ ok: false, error: "corrupt" })
    expect(localStorage.getItem(SAVED_WORKOUTS_KEY)).toBe("{broken")
    expect(createWorkoutRepository(() => null).importDrafts([draft()])).toEqual({ ok: false, error: "unavailable" })
  })

  it("fails on ID collision before writing and never touches the session key", () => {
    localStorage.setItem(STORAGE_KEY, "session")
    const repo = createWorkoutRepository(undefined, () => "same")
    expect(repo.importDrafts([draft("А"), draft("Б")])).toEqual({ ok: false, error: "invalid" })
    expect(localStorage.getItem(SAVED_WORKOUTS_KEY)).toBeNull()
    expect(localStorage.getItem(STORAGE_KEY)).toBe("session")
  })
})
