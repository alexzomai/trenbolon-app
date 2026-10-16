/**
 * Short end-of-rest beep via the Web Audio API.
 *
 * No audio file is fetched; the tone is synthesised. Browsers only allow an
 * AudioContext to start from a user gesture, so `unlockAudio()` is called from
 * the click handlers that can lead to a rest ending, and the context is reused
 * afterwards. Every entry point is guarded: on a browser without Web Audio, or
 * when the context refuses to resume, the app carries on silently.
 */

type AudioContextConstructor = new () => AudioContext

let context: AudioContext | null = null

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

/** Play the end-of-rest tone. Returns false when nothing could be played. */
export function playBeep(): boolean {
  try {
    const Ctor = getAudioContextConstructor()
    if (!Ctor) return false
    context ??= new Ctor()
    if (context.state === "suspended") {
      void context.resume().catch(() => undefined)
    }
    if (context.state !== "running") return false

    const now = context.currentTime
    const gain = context.createGain()
    gain.connect(context.destination)

    // Two short pips, shaped with a ramp so there is no click at the edges.
    for (const [offset, frequency] of [
      [0, 880],
      [0.22, 1174.66],
    ] as const) {
      const oscillator = context.createOscillator()
      oscillator.type = "sine"
      oscillator.frequency.setValueAtTime(frequency, now + offset)

      const envelope = context.createGain()
      envelope.gain.setValueAtTime(0.0001, now + offset)
      envelope.gain.exponentialRampToValueAtTime(0.2, now + offset + 0.02)
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18)

      oscillator.connect(envelope)
      envelope.connect(gain)
      oscillator.start(now + offset)
      oscillator.stop(now + offset + 0.2)
    }

    return true
  } catch {
    return false
  }
}

/** Test seam: forget the cached context. */
export function resetAudioForTests(): void {
  context = null
}
