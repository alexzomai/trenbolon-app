/**
 * End-of-rest alarm via the Web Audio API.
 *
 * No audio file is fetched; the tone is synthesised. The alarm is a repeating
 * burst of alternating 880/1175 Hz pulses that keeps sounding until
 * `stopAlarm()` is called, so it is hard to miss mid-set.
 *
 * Browsers only allow an AudioContext to start from a user gesture, so
 * `unlockAudio()` is called from the click handlers that can lead to a rest
 * ending, and the context is reused afterwards. Every entry point is guarded:
 * on a browser without Web Audio, or when the context refuses to resume, the
 * app carries on silently.
 *
 * Cancellation is generation-based: `stopAlarm()` bumps the generation, which
 * invalidates the pending repeat timer and any `resume()` continuation, so a
 * context that only becomes runnable after the stop can never start the alarm
 * late.
 */

type AudioContextConstructor = new () => AudioContext

let context: AudioContext | null = null

/** Bumped by every start and stop; stale callbacks compare against it and bail. */
let generation = 0
let repeatTimer: number | null = null
/** Every node still in flight, so a stop can release the whole graph. */
const liveVoices = new Set<{ oscillator: OscillatorNode; envelope: GainNode }>()

// One burst: four pulses, alternating pitch and waveform, then a short pause.
const PULSES = [
  { frequency: 880, type: "square" },
  { frequency: 1174.66, type: "triangle" },
  { frequency: 880, type: "square" },
  { frequency: 1174.66, type: "triangle" },
] as const
const PULSE_LENGTH = 0.18
const PULSE_GAP = 0.12
const BURST_PAUSE = 0.45
/** Gain stays well under 1 even with four pulses in flight — no clipping. */
const PEAK_GAIN = 0.25
const CYCLE_MS = Math.round(
  (PULSES.length * (PULSE_LENGTH + PULSE_GAP) + BURST_PAUSE) * 1000
)

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null
  const candidate =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextConstructor })
      .webkitAudioContext
  return candidate ?? null
}

export function isAudioSupported(): boolean {
  return getAudioContextConstructor() !== null
}

/**
 * Create (or resume) the shared AudioContext. Safe to call on every user
 * gesture; after the first success it is a cheap no-op.
 */
export function unlockAudio(): void {
  try {
    const Ctor = getAudioContextConstructor()
    if (!Ctor) return
    context ??= new Ctor()
    if (context.state === "suspended") {
      void context.resume().catch(() => undefined)
    }
  } catch {
    context = null
  }
}

/** Schedule one burst of pulses. Caller has already checked the generation. */
function playBurst(ctx: AudioContext): void {
  const now = ctx.currentTime

  PULSES.forEach(({ frequency, type }, index) => {
    const offset = index * (PULSE_LENGTH + PULSE_GAP)
    const oscillator = ctx.createOscillator()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, now + offset)

    // Ramped edges: an abrupt start or stop is audible as a click.
    const envelope = ctx.createGain()
    envelope.gain.setValueAtTime(0.0001, now + offset)
    envelope.gain.exponentialRampToValueAtTime(PEAK_GAIN, now + offset + 0.02)
    envelope.gain.exponentialRampToValueAtTime(
      0.0001,
      now + offset + PULSE_LENGTH
    )

    oscillator.connect(envelope)
    envelope.connect(ctx.destination)

    const voice = { oscillator, envelope }
    liveVoices.add(voice)
    oscillator.onended = () => {
      liveVoices.delete(voice)
      try {
        oscillator.disconnect()
        envelope.disconnect()
      } catch {
        // Already torn down by stopAlarm; nothing left to release.
      }
    }

    oscillator.start(now + offset)
    oscillator.stop(now + offset + PULSE_LENGTH + 0.02)
  })
}

function runCycle(ctx: AudioContext, ownGeneration: number): void {
  if (ownGeneration !== generation) return
  try {
    playBurst(ctx)
  } catch {
    stopAlarm()
    return
  }
  repeatTimer = window.setTimeout(() => {
    repeatTimer = null
    runCycle(ctx, ownGeneration)
  }, CYCLE_MS)
}

/**
 * Start the repeating end-of-rest alarm. Any alarm already sounding is stopped
 * first, so bursts never overlap. Returns false when nothing could be played.
 */
export function startAlarm(): boolean {
  stopAlarm()
  try {
    const Ctor = getAudioContextConstructor()
    if (!Ctor) return false
    context ??= new Ctor()
    const ctx = context
    const ownGeneration = generation

    if (ctx.state === "running") {
      runCycle(ctx, ownGeneration)
      return true
    }

    if (ctx.state === "suspended") {
      // The context may only become runnable a tick later; the generation check
      // inside the continuation keeps a stop in the meantime authoritative.
      void ctx
        .resume()
        .then(() => {
          if (ownGeneration !== generation) return
          if (ctx.state !== "running") return
          runCycle(ctx, ownGeneration)
        })
        .catch(() => undefined)
      return true
    }

    return false
  } catch {
    return false
  }
}

/** Silence the alarm immediately and cancel every scheduled repeat. */
export function stopAlarm(): void {
  generation += 1
  if (repeatTimer !== null) {
    window.clearTimeout(repeatTimer)
    repeatTimer = null
  }
  for (const { oscillator, envelope } of liveVoices) {
    oscillator.onended = null
    try {
      // Pull the stop forward to now; a node that already ended may throw,
      // which is the desired state anyway.
      oscillator.stop()
    } catch {
      // Already finished.
    }
    // Always release the graph, even if the stop above threw.
    try {
      oscillator.disconnect()
      envelope.disconnect()
    } catch {
      // Already disconnected by `onended`.
    }
  }
  liveVoices.clear()
}

/** Test seam: forget the cached context and drop any pending audio. */
export function resetAudioForTests(): void {
  stopAlarm()
  context = null
}
