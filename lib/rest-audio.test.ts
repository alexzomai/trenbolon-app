import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ALARM_SECONDS, makeRestWav, RestAudio } from "./rest-audio"

class FakeAudio {
  static instances: FakeAudio[] = []
  static playResult: () => Promise<void> = () => Promise.resolve()
  currentTime = 0
  paused = false
  ended = false
  loop = false
  preload = ""
  onpause: (() => void) | null = null
  onended: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeupdate: (() => void) | null = null
  play = vi.fn(() => FakeAudio.playResult())
  pause = vi.fn(() => { this.paused = true; this.onpause?.() })
  load = vi.fn()
  removeAttribute = vi.fn()
  constructor(public src: string) { FakeAudio.instances.push(this) }
}

beforeEach(() => {
  vi.useFakeTimers({ now: 100_000 })
  FakeAudio.instances = []
  FakeAudio.playResult = () => Promise.resolve()
  vi.stubGlobal("Audio", FakeAudio)
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test")
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe("finite PCM timeline", () => {
  it("contains a real silent rest then finite audible alarm, without looping", () => {
    const view = new DataView(makeRestWav(1000))
    expect(view.getUint32(24, true)).toBe(8000)
    expect(view.getUint32(40, true)).toBe((1 + ALARM_SECONDS) * 8000 * 2)
    for (let i = 44; i < 44 + 16000; i += 2) expect(view.getInt16(i, true)).toBe(0)
    expect(view.getInt16(44 + 16000 + 101 * 2, true)).not.toBe(0)
  })
  it.each([-1, NaN, Infinity, 600001])("bounds allocation for %s", (ms) => {
    expect(() => makeRestWav(ms)).toThrow(RangeError)
  })
})

describe("rest media lifecycle", () => {
  it("aligns delayed loading to the wall-clock deadline, without an early false interruption", async () => {
    let resolve!: () => void
    FakeAudio.playResult = () => new Promise<void>((done) => { resolve = done })
    const audio = new RestAudio()
    audio.start(190_000)
    vi.setSystemTime(105_000)
    audio.reconcile()
    expect(audio.ownsDeadline(190_000)).toBe(true)
    resolve(); await Promise.resolve()
    expect(FakeAudio.instances[0].currentTime).toBe(5)
    audio.stop()
  })
  it("cancels play that resolves after its deadline, rather than sounding late", async () => {
    let resolve!: () => void
    FakeAudio.playResult = () => new Promise<void>((done) => { resolve = done })
    const audio = new RestAudio()
    audio.start(190_000)
    vi.setSystemTime(195_000)
    resolve(); await Promise.resolve()
    expect(audio.ownsDeadline(190_000)).toBe(false)
    expect(FakeAudio.instances[0].pause).toHaveBeenCalledOnce()
  })
  it("starts play synchronously and owns one deadline", async () => {
    const audio = new RestAudio()
    expect(audio.start(190_000)).toBe(true)
    const media = FakeAudio.instances[0]
    expect(media.play).toHaveBeenCalledTimes(1)
    expect(media.loop).toBe(false)
    await Promise.resolve()
    vi.setSystemTime(190_000); media.currentTime = 90
    expect(audio.isAlarm()).toBe(true)
    expect(audio.ownsDeadline(190_000)).toBe(true)
    audio.stop()
    expect(media.pause).toHaveBeenCalledOnce()
    expect(media.removeAttribute).toHaveBeenCalledWith("src")
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test")
    expect(audio.isAlarm()).toBe(false)
  })
  it("replaces rather than overlaps and ignores an old play resolution", async () => {
    let resolve!: () => void
    FakeAudio.playResult = () => new Promise<void>((done) => { resolve = done })
    const notify = vi.fn()
    const audio = new RestAudio(notify)
    audio.start(190_000)
    const old = FakeAudio.instances[0]
    audio.stop(); resolve(); await Promise.resolve()
    expect(notify).not.toHaveBeenCalledWith("playing")
    audio.start(160_000)
    expect(old.pause).toHaveBeenCalledOnce()
    expect(audio.ownsDeadline(160_000)).toBe(true)
    audio.stop()
  })
  it("surfaces autoplay rejection and releases the failed source", async () => {
    FakeAudio.playResult = () => Promise.reject(new Error("NotAllowedError"))
    const notify = vi.fn()
    const audio = new RestAudio(notify)
    audio.start(190_000)
    await Promise.resolve(); await Promise.resolve()
    expect(notify).toHaveBeenLastCalledWith("blocked")
    expect(audio.ownsDeadline(190_000)).toBe(false)
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce()
  })
  it("does not ring a suspended track late on unlock", async () => {
    const notify = vi.fn()
    const audio = new RestAudio(notify)
    audio.start(190_000); await Promise.resolve()
    vi.setSystemTime(195_000)
    FakeAudio.instances[0].currentTime = 20
    audio.reconcile()
    expect(notify).toHaveBeenLastCalledWith("interrupted")
    expect(audio.isAlarm()).toBe(false)
    expect(FakeAudio.instances[0].play).toHaveBeenCalledOnce()
  })
  it("allows on-time background playback without JS at the deadline", async () => {
    const audio = new RestAudio()
    audio.start(190_000); await Promise.resolve()
    vi.setSystemTime(196_000); FakeAudio.instances[0].currentTime = 96
    audio.reconcile()
    expect(audio.isAlarm()).toBe(true)
    expect(FakeAudio.instances[0].play).toHaveBeenCalledOnce()
    audio.stop()
  })
  it("clears resources at natural end and when the OS pauses playback", async () => {
    const notify = vi.fn()
    const audio = new RestAudio(notify)
    audio.start(190_000); await Promise.resolve()
    FakeAudio.instances[0].onended?.()
    expect(audio.ownsDeadline(190_000)).toBe(false)
    audio.start(160_000); await Promise.resolve()
    FakeAudio.instances[1].onpause?.()
    expect(notify).toHaveBeenLastCalledWith("interrupted")
    expect(audio.ownsDeadline(160_000)).toBe(false)
  })
  it("never starts expired/restored deadlines or unbounded tracks", () => {
    const audio = new RestAudio()
    expect(audio.start(99_000)).toBe(false)
    expect(audio.start(800_000)).toBe(false)
    expect(FakeAudio.instances).toHaveLength(0)
  })
})
