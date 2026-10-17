import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import { WORKOUTS } from "./workout-plan"
import { STORAGE_KEY } from "./workout-storage"
import {
  createWorkoutRepository, draftFromWorkout, SAVED_WORKOUTS_KEY,
  type StorageResult, type WorkoutDraft,
} from "./saved-workouts"

function value<T>(result: StorageResult<T>): T {
  if (!result.ok) throw new Error(result.error)
  return result.value
}
const draft = () => draftFromWorkout(WORKOUTS.pull, 120, false)
const repo = () => createWorkoutRepository()
beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe("saved workout definitions", () => {
  it("starts empty without writing during reads", () => {
    expect(value(repo().list())).toEqual([])
    expect(localStorage.getItem(SAVED_WORKOUTS_KEY)).toBeNull()
  })
  it("restores every parameter and exercise order in a new repository (page reload)", () => {
    const input = draft()
    input.exercises = [{ id: "custom", name: "Свой этап", sets: 2, setOptions: [2, 3], reps: "до отказа", weight: "свой вес" }, ...input.exercises].reverse()
    const saved = value(repo().create(input))
    expect(saved.id).toMatch(/^user:/)
    expect(value(repo().get(saved.id))).toEqual({ ...input, id: saved.id })
    expect(JSON.parse(localStorage.getItem(SAVED_WORKOUTS_KEY)!)).toEqual({ version: 1, workouts: [saved] })
  })
  it("creates separate stable IDs, updates in place, deletes persistently", () => {
    const first = value(repo().create(draft()))
    const second = value(repo().create(draft()))
    expect(first.id).not.toBe(second.id)
    const changed = { ...draft(), title: "Изменённая", label: "Своя", restSeconds: 180 }
    expect(value(repo().update(first.id, changed))).toEqual({ ...changed, id: first.id })
    expect(value(repo().list()).map((w) => w.id)).toEqual([first.id, second.id])
    expect(repo().remove(first.id)).toEqual({ ok: true, value: null })
    expect(repo().get(first.id)).toEqual({ ok: false, error: "not-found" })
    expect(value(repo().list())).toEqual([second])
    expect(repo().remove(second.id).ok).toBe(true)
    expect(value(repo().list())).toEqual([])
  })
  it("never mutates templates or retains references to editor data", () => {
    const snapshot = JSON.stringify(WORKOUTS)
    const input = draft()
    input.exercises[0].name = "Своя версия"
    const saved = value(repo().create(input))
    input.exercises[0].name = "Не сохранено"
    saved.exercises[0].weight = "999"
    const read = value(repo().get(saved.id))
    expect(read.exercises[0].name).toBe("Своя версия")
    expect(read.exercises[0].weight).toBe("")
    expect(JSON.stringify(WORKOUTS)).toBe(snapshot)
    expect(repo().update("pull", input)).toEqual({ ok: false, error: "not-found" })
  })
  it("keeps existing session storage separate", () => {
    localStorage.setItem(STORAGE_KEY, "existing session")
    repo().create(draft())
    expect(localStorage.getItem(STORAGE_KEY)).toBe("existing session")
  })
  it.each([
    { title: " " }, { label: "" }, { exercises: [] }, { restSeconds: 17 }, { soundEnabled: "yes" },
    { exercises: [{ ...draft().exercises[0], sets: 0 }] },
    { exercises: [{ ...draft().exercises[0], sets: 1.5 }] },
    { exercises: [{ ...draft().exercises[0], sets: Infinity }] },
    { exercises: [{ ...draft().exercises[0], reps: "" }] },
    { exercises: [{ ...draft().exercises[0], id: "__proto__" }] },
    { exercises: [{ ...draft().exercises[0], setOptions: [2] }] },
    { exercises: [draft().exercises[0], draft().exercises[0]] },
  ])("rejects invalid draft %j without writing", (override) => {
    expect(repo().create({ ...draft(), ...override } as WorkoutDraft)).toEqual({ ok: false, error: "invalid" })
    expect(localStorage.getItem(SAVED_WORKOUTS_KEY)).toBeNull()
  })
  it.each(["{", "null", "[]", '{"version":1,"workouts":[{}]}'])("preserves corrupted data: %s", (raw) => {
    localStorage.setItem(SAVED_WORKOUTS_KEY, raw)
    expect(repo().list()).toEqual({ ok: false, error: "corrupt" })
    expect(repo().create(draft())).toEqual({ ok: false, error: "corrupt" })
    expect(repo().remove("user:missing")).toEqual({ ok: false, error: "corrupt" })
    expect(localStorage.getItem(SAVED_WORKOUTS_KEY)).toBe(raw)
  })
  it("preserves future schema versions and blocks changes", () => {
    const raw = '{"version":99,"workouts":[]}'
    localStorage.setItem(SAVED_WORKOUTS_KEY, raw)
    expect(repo().create(draft())).toEqual({ ok: false, error: "unsupported-version" })
    expect(localStorage.getItem(SAVED_WORKOUTS_KEY)).toBe(raw)
  })
  it("rejects duplicate stored IDs and malformed exercise parameters", () => {
    const saved = value(repo().create(draft()))
    for (const workouts of [[saved, saved], [{ ...saved, exercises: [{ ...saved.exercises[0], sets: -1 }] }]]) {
      localStorage.setItem(SAVED_WORKOUTS_KEY, JSON.stringify({ version: 1, workouts }))
      expect(repo().list()).toEqual({ ok: false, error: "corrupt" })
    }
  })
  it("reports inaccessible property/read and SSR without throwing", () => {
    const denied = createWorkoutRepository(() => { throw new Error("denied") })
    expect(denied.list()).toEqual({ ok: false, error: "unavailable" })
    expect(denied.create(draft())).toEqual({ ok: false, error: "unavailable" })
    expect(denied.remove("user:x")).toEqual({ ok: false, error: "unavailable" })
    expect(createWorkoutRepository(() => null).list().ok).toBe(false)
    expect(createWorkoutRepository(() => ({ getItem() { throw new Error() }, setItem() {} })).list()).toEqual({ ok: false, error: "unavailable" })
    vi.stubGlobal("window", undefined)
    expect(repo().list()).toEqual({ ok: false, error: "unavailable" })
    vi.unstubAllGlobals()
  })
  it.each(["QuotaExceededError", "NS_ERROR_DOM_QUOTA_REACHED", "SecurityError"])("never reports success on failed create/update/delete: %s", (name) => {
    const saved = value(repo().create(draft()))
    const before = localStorage.getItem(SAVED_WORKOUTS_KEY)
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("failed", name) })
    const error = name === "SecurityError" ? "write-failed" : "quota"
    expect(repo().create(draft())).toEqual({ ok: false, error })
    expect(repo().update(saved.id, { ...draft(), title: "Не сохранено" })).toEqual({ ok: false, error })
    expect(repo().remove(saved.id)).toEqual({ ok: false, error })
    expect(localStorage.getItem(SAVED_WORKOUTS_KEY)).toBe(before)
    expect(value(repo().get(saved.id))).toEqual(saved)
  })
  it("does not overwrite another repository's latest writes", () => {
    const a = repo(), b = repo()
    value(a.list())
    const saved = value(b.create(draft()))
    value(a.create(draft()))
    expect(value(b.list())).toHaveLength(2)
    expect(value(a.get(saved.id))).toEqual(saved)
  })
  it("rejects ID collisions and handles unavailable UUID generation", () => {
    const sameId = createWorkoutRepository(() => localStorage, () => "same")
    expect(sameId.create(draft()).ok).toBe(true)
    expect(sameId.create(draft())).toEqual({ ok: false, error: "invalid" })
    expect(value(sameId.list())).toHaveLength(1)
    const broken = createWorkoutRepository(() => localStorage, () => { throw new Error() })
    expect(broken.create(draft())).toEqual({ ok: false, error: "unavailable" })
  })
})
