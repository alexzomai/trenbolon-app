import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  isAudioSupported,
  resetAudioForTests,
  startAlarm,
  stopAlarm,
  unlockAudio,
} from "./beep"

/**
 * A Web Audio stand-in that records what the scheduler asks for. Only the
 * handful of nodes `beep.ts` touches are implemented; anything else would be
 * an unverified assumption about the real API.
 */
class FakeParam {
  readonly events: Array<[string, number, number]> = []
  setValueAtTime(value: number, time: number) {
    this.events.push(["set", value, time])
    return this
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    this.events.push(["ramp", value, time])
    return this
  }
}

class FakeNode {
  disconnects = 0
  connect = vi.fn()
  disconnect = vi.fn(() => {
    this.disconnects += 1
  })
}

class FakeOscillator extends FakeNode {
  type = ""
  readonly frequency = new FakeParam()
  onended: (() => void) | null = null
  startedAt: number | null = null
  stoppedAt: number | null = null
  start(time: number) {
    this.startedAt = time
  }
  stop(time?: number) {
    if (this.stoppedAt !== null) throw new Error("already stopped")
    this.stoppedAt = time ?? -1
  }
}

class FakeGain extends FakeNode {
  readonly gain = new FakeParam()
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  /** Mutable so a test can make the context start out suspended. */
  static initialState: AudioContextState = "running"
  state: AudioContextState
  currentTime = 0
  destination = new FakeNode()
  oscillators: FakeOscillator[] = []
  gains: FakeGain[] = []
  resumeCalls = 0
  /** Resolved by the test to emulate an async `resume()`. */
  releaseResume: (() => void) | null = null

  constructor() {
    this.state = FakeAudioContext.initialState
    FakeAudioContext.instances.push(this)
  }

  resume(): Promise<void> {
    this.resumeCalls += 1
    return new Promise((resolve) => {
      this.releaseResume = () => {
        this.state = "running"
        resolve()
      }
    })
  }

  createOscillator(): OscillatorNode {
    const oscillator = new FakeOscillator()
    this.oscillators.push(oscillator)
    return oscillator as unknown as OscillatorNode
  }

  createGain(): GainNode {
    const gain = new FakeGain()
    this.gains.push(gain)
    return gain as unknown as GainNode
  }
}

/** Pulses per burst — kept in step with the scheduler's pattern. */
const PULSES_PER_BURST = 4
/** Burst length + pause, in ms. */
const CYCLE_MS = 1_650

function ctx(): FakeAudioContext {
  expect(FakeAudioContext.instances).toHaveLength(1)
  return FakeAudioContext.instances[0]
}

/** Oscillators not yet torn down — i.e. the ones a cancellation left behind. */
function leftoverOscillators(): FakeOscillator[] {
  return ctx().oscillators.filter((oscillator) => oscillator.disconnects === 0)
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeAudioContext.instances = []
  FakeAudioContext.initialState = "running"
  Object.defineProperty(window, "AudioContext", {
    configurable: true,
    writable: true,
    value: FakeAudioContext,
  })
  resetAudioForTests()
})

afterEach(() => {
  stopAlarm()
  resetAudioForTests()
  vi.useRealTimers()
  Reflect.deleteProperty(window as unknown as Record<string, unknown>, "AudioContext")
})

describe("support and unlocking", () => {
  it("reports support and reuses one context across gestures", () => {
    expect(isAudioSupported()).toBe(true)
    unlockAudio()
    unlockAudio()
    expect(FakeAudioContext.instances).toHaveLength(1)
  })

  it("reports no support and never throws without Web Audio", () => {
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, "AudioContext")
    expect(isAudioSupported()).toBe(false)
    expect(() => unlockAudio()).not.toThrow()
    expect(startAlarm()).toBe(false)
    expect(() => stopAlarm()).not.toThrow()
  })

  it("resumes a suspended context from a gesture", () => {
    FakeAudioContext.initialState = "suspended"
    unlockAudio()
    expect(ctx().resumeCalls).toBe(1)
  })
})

describe("startAlarm", () => {
  it("schedules a multi-tone burst with ramped, bounded gain", () => {
    expect(startAlarm()).toBe(true)

    const { oscillators, gains } = ctx()
    expect(oscillators).toHaveLength(PULSES_PER_BURST)
    expect(oscillators.map((o) => o.type)).toEqual([
      "square",
      "triangle",
      "square",
      "triangle",
    ])
    expect(oscillators.map((o) => o.frequency.events[0][1])).toEqual([
      880, 1174.66, 880, 1174.66,
    ])

    // Pulses are sequential, never piled on the same instant.
    const starts = oscillators.map((o) => o.startedAt!)
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
    expect(new Set(starts).size).toBe(PULSES_PER_BURST)
    // Each pulse stops before the next one starts.
    oscillators.forEach((oscillator, index) => {
      expect(oscillator.stoppedAt!).toBeGreaterThan(oscillator.startedAt!)
      if (index + 1 < oscillators.length) {
        expect(oscillator.stoppedAt!).toBeLessThanOrEqual(starts[index + 1])
      }
    })

    // Every pulse ramps up from near-silence and back down, and stays quiet
    // enough that four of them cannot clip.
    for (const gain of gains) {
      const peaks = gain.gain.events.map(([, value]) => value)
      expect(Math.max(...peaks)).toBeLessThanOrEqual(0.3)
      expect(gain.gain.events[0][0]).toBe("set")
      expect(gain.gain.events.at(-1)![0]).toBe("ramp")
      expect(gain.gain.events.at(-1)![1]).toBeLessThan(0.001)
    }
  })

  it("repeats until stopped", () => {
    startAlarm()
    expect(ctx().oscillators).toHaveLength(PULSES_PER_BURST)

    vi.advanceTimersByTime(CYCLE_MS)
    expect(ctx().oscillators).toHaveLength(2 * PULSES_PER_BURST)

    vi.advanceTimersByTime(10 * CYCLE_MS)
    expect(ctx().oscillators.length).toBeGreaterThanOrEqual(10 * PULSES_PER_BURST)
  })

  it("does not overlap bursts when started twice", () => {
    startAlarm()
    const first = ctx().oscillators.slice()

    startAlarm()
    // The first burst was cancelled outright, so only the new one can sound.
    for (const oscillator of first) {
      expect(oscillator.disconnects).toBeGreaterThan(0)
    }
    // The new burst's own nodes are still live; nothing from the old one is.
    expect(leftoverOscillators()).toHaveLength(PULSES_PER_BURST)

    // And only one repeat chain survives.
    const before = ctx().oscillators.length
    vi.advanceTimersByTime(CYCLE_MS)
    expect(ctx().oscillators).toHaveLength(before + PULSES_PER_BURST)
  })
})

describe("stopAlarm", () => {
  it("silences the current burst and cancels every repeat", () => {
    startAlarm()
    const scheduled = ctx().oscillators.slice()

    stopAlarm()

    for (const oscillator of scheduled) {
      expect(oscillator.disconnects).toBeGreaterThan(0)
      expect(oscillator.onended).toBeNull()
    }
    expect(leftoverOscillators()).toHaveLength(0)
    // Matching disconnect for every envelope: no leftover nodes on destination.
    for (const gain of ctx().gains) {
      expect(gain.disconnects).toBeGreaterThan(0)
    }

    vi.advanceTimersByTime(60_000)
    expect(ctx().oscillators).toHaveLength(PULSES_PER_BURST)
  })

  it("is a no-op when nothing is sounding", () => {
    expect(() => {
      stopAlarm()
      stopAlarm()
    }).not.toThrow()
    expect(FakeAudioContext.instances).toHaveLength(0)
  })

  it("keeps a late resume from starting the alarm after a stop", async () => {
    FakeAudioContext.initialState = "suspended"
    expect(startAlarm()).toBe(true)
    expect(ctx().oscillators).toHaveLength(0)

    stopAlarm()
    ctx().releaseResume!()
    await vi.runAllTimersAsync()

    expect(ctx().oscillators).toHaveLength(0)
  })

  it("starts once a suspended context has resumed", async () => {
    FakeAudioContext.initialState = "suspended"
    startAlarm()

    ctx().releaseResume!()
    await Promise.resolve()
    await Promise.resolve()

    expect(ctx().oscillators).toHaveLength(PULSES_PER_BURST)
    vi.advanceTimersByTime(CYCLE_MS)
    expect(ctx().oscillators).toHaveLength(2 * PULSES_PER_BURST)
  })

  it("stops cleanly when the context dies mid-alarm", () => {
    startAlarm()
    const context = ctx()
    context.createOscillator = () => {
      throw new Error("context closed")
    }

    vi.advanceTimersByTime(CYCLE_MS)

    // The failed cycle cancelled itself instead of retrying forever.
    const count = context.oscillators.length
    vi.advanceTimersByTime(10 * CYCLE_MS)
    expect(context.oscillators).toHaveLength(count)
  })
})
