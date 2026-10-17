/** A single finite media timeline: silence for the rest, then a 30 s alarm.
 * No JS callback or source change is required at the deadline. This improves
 * the chance of lock-screen playback, but silence does NOT defeat OS suspension.
 */
export const ALARM_SECONDS = 30
export const FRESH_ALARM_MS = 2000
const RATE = 8000
const MAX_REST_MS = 10 * 60 * 1000

export function makeRestWav(restMs: number): ArrayBuffer {
  if (!Number.isFinite(restMs) || restMs < 0 || restMs > MAX_REST_MS) {
    throw new RangeError("Rest must be between 0 and 600000 ms")
  }
  const silentSamples = Math.ceil(restMs * RATE / 1000)
  const samples = silentSamples + ALARM_SECONDS * RATE
  const buffer = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buffer)
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i))
  }
  text(0, "RIFF"); view.setUint32(4, 36 + samples * 2, true)
  text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true)
  view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, RATE, true); view.setUint32(28, RATE * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, "data"); view.setUint32(40, samples * 2, true)
  for (let i = silentSamples; i < samples; i++) {
    const t = (i - silentSamples) / RATE
    const cycle = t % 1.65
    const pulse = Math.floor(cycle / 0.3)
    const phase = cycle % 0.3
    if (pulse >= 4 || phase >= 0.18) continue
    const envelope = Math.min(1, phase / 0.02, (0.18 - phase) / 0.02)
    const frequency = pulse % 2 ? 1174.66 : 880
    view.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * frequency * t) * envelope * 8191), true)
  }
  return buffer
}

export type RestAudioStatus = "idle" | "playing" | "blocked" | "interrupted"

export class RestAudio {
  private media: HTMLAudioElement | null = null
  private url: string | null = null
  private generation = 0
  private deadline: number | null = null
  private startedAt = 0
  private status: RestAudioStatus = "idle"
  constructor(private notify: (status: RestAudioStatus) => void = () => {}) {}

  private report(status: RestAudioStatus) {
    this.status = status
    this.notify(status)
  }

  /** Invoke synchronously INSIDE a click handler, not an effect/await continuation. */
  start(deadline: number, now = Date.now()): boolean {
    this.stop()
    const remaining = deadline - now
    if (remaining <= 0 || remaining > MAX_REST_MS || typeof Audio === "undefined" ||
        typeof URL.createObjectURL !== "function") return false
    const own = this.generation
    try {
      this.url = URL.createObjectURL(new Blob([makeRestWav(remaining)], { type: "audio/wav" }))
      const media = new Audio(this.url)
      this.media = media
      this.deadline = deadline
      this.startedAt = now
      media.preload = "auto"
      media.loop = false
      media.onpause = () => {
        if (own === this.generation && !media.ended) this.fail("interrupted")
      }
      media.onerror = () => { if (own === this.generation) this.fail("blocked") }
      media.onended = () => { if (own === this.generation) this.stop() }
      // The media clock must not lag behind the wall clock and ring late after
      // a suspended decoder resumes. timeupdate is best effort, not an OS promise.
      media.ontimeupdate = () => this.reconcile()
      const play = media.play()
      void play.then(() => {
        if (own !== this.generation) return
        // Align a slowly loaded blob before silence ends; do not shift the
        // real deadline into the future or start an overdue alarm.
        const timestamp = Date.now()
        if (timestamp > deadline + FRESH_ALARM_MS) {
          this.fail("interrupted")
          return
        }
        const elapsed = (timestamp - this.startedAt) / 1000
        if (elapsed - media.currentTime > 0.25) media.currentTime = Math.max(0, elapsed)
        this.report("playing")
        this.reconcile()
      }).catch(() => { if (own === this.generation) this.fail("blocked") })
      return true
    } catch {
      this.fail("blocked")
      return false
    }
  }

  private fail(status: "blocked" | "interrupted") {
    this.stop()
    this.report(status)
  }

  /** Never restart playback automatically on focus/unlock. Discard stale audio. */
  reconcile(now = Date.now()): void {
    if (!this.media || this.deadline === null) return
    if (this.status !== "playing") {
      if (now > this.deadline + FRESH_ALARM_MS) this.fail("interrupted")
      return
    }
    const lag = (now - this.startedAt) - this.media.currentTime * 1000
    if (now >= this.deadline + ALARM_SECONDS * 1000 || Math.abs(lag) > FRESH_ALARM_MS) {
      this.fail("interrupted")
    }
  }

  ownsDeadline(deadline: number): boolean {
    return this.media !== null && this.deadline === deadline
  }

  isAlarm(now = Date.now()): boolean {
    return this.media !== null && this.deadline !== null && now >= this.deadline &&
      now < this.deadline + ALARM_SECONDS * 1000 && this.status === "playing" && !this.media.paused
  }

  stop(): void {
    this.generation++
    if (this.media) {
      const media = this.media
      media.onpause = media.onerror = media.onended = media.ontimeupdate = null
      media.pause()
      media.removeAttribute("src")
      media.load()
      this.media = null
    }
    if (this.url) URL.revokeObjectURL(this.url)
    this.url = null
    this.deadline = null
    this.report("idle")
  }
}
