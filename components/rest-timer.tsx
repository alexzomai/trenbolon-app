"use client"

import { ChevronDown, Pause, Play, SkipForward, Timer } from "lucide-react"
import { useEffect, useId, useRef, useState, type RefObject } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { REST_SECONDS_MESSAGE, parseRestSeconds } from "@/lib/workout-editor"
import { REST_PRESETS } from "@/lib/workout-plan"
import {
  REST_KIND_LABELS,
  TIMER_DISABLED_LABEL,
  TIMER_STATUS_LABELS,
  formatDuration,
  type RestKind,
  type RestSettings,
  type TimerState,
} from "@/lib/workout-state"

interface RestTimerProps {
  timer: TimerState
  /** Milliseconds left, already derived from the deadline by the parent. */
  remainingMs: number
  /** Durations and the between-set selection. */
  rest: RestSettings
  /** Whether rest countdowns run at all. */
  timerEnabled: boolean
  soundEnabled: boolean
  audioSupported: boolean
  /**
   * Adopts a duration for one kind of rest. `mode` is only meaningful between
   * sets and says which of the two choices the user actually pressed.
   */
  onSelectDuration: (
    seconds: number,
    options?: { kind?: RestKind; mode?: RestSettings["mode"] }
  ) => void
  onPauseResume: () => void
  onSkip: () => void
  onSoundChange: (enabled: boolean) => void
  onTimerEnabledChange: (enabled: boolean) => void
  /** True only while the end-of-rest alarm is actually sounding. */
  alarmActive: boolean
  onStopAlarm: () => void
}

export const STOP_ALARM_LABEL = "Остановить сигнал"
export const TIMER_SWITCH_LABEL = "Таймер отдыха"
export const CUSTOM_REST_LABEL = "Своё время"
export const CUSTOM_REST_FIELD_LABEL = "Своё время отдыха между подходами, с"
export const EXERCISE_REST_FIELD_LABEL = "Между упражнениями, с"
export const APPLY_LABEL = "Применить"
export const REST_SETTINGS_LABEL = "Настройки отдыха"
export const PAUSE_LABEL = "Пауза"
export const RESUME_LABEL = "Продолжить"
export const SKIP_LABEL = "Пропустить"

/**
 * A seconds field that only ever commits a valid whole number, and only when
 * applied: typing does not restart a running rest, and an empty, fractional,
 * negative or oversized draft is reported instead of being stored.
 */
function SecondsField({
  label,
  committed,
  onApply,
  applyLabel,
  inputRef,
}: {
  label: string
  /** The stored value. A change from elsewhere (reset, reload) refills the draft. */
  committed: number
  onApply: (seconds: number) => void
  applyLabel: string
  inputRef?: RefObject<HTMLInputElement | null>
}) {
  const id = useId()
  const errorId = `${id}-error`
  const [draft, setDraft] = useState(String(committed))
  const [seen, setSeen] = useState(committed)
  const [error, setError] = useState<string | null>(null)

  // Adjusting state during render rather than in an effect: no extra pass, and
  // the field never shows a stale draft after the session is reset or restored.
  if (seen !== committed) {
    setSeen(committed)
    setDraft(String(committed))
    setError(null)
  }

  const apply = () => {
    const seconds = parseRestSeconds(draft)
    if (seconds === null) {
      setError(REST_SECONDS_MESSAGE)
      return
    }
    setError(null)
    setDraft(String(seconds))
    onApply(seconds)
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
      <div className="flex min-w-0 items-center gap-2">
        <Input
          id={id}
          ref={inputRef}
          value={draft}
          inputMode="numeric"
          autoComplete="off"
          className="h-11 min-w-0 flex-1 tabular-nums"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            event.preventDefault()
            apply()
          }}
        />
        <Button
          type="button"
          variant="secondary"
          className="h-11 shrink-0 px-3 font-normal"
          onClick={apply}
        >
          {applyLabel}
        </Button>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

export function RestTimer({
  timer,
  remainingMs,
  rest,
  timerEnabled,
  soundEnabled,
  audioSupported,
  onSelectDuration,
  onPauseResume,
  onSkip,
  onSoundChange,
  onTimerEnabledChange,
  alarmActive,
  onStopAlarm,
}: RestTimerProps) {
  const headingId = useId()
  const soundId = useId()
  const timerId = useId()
  const settingsId = useId()

  const isPaused = timer.status === "paused"
  const isIdle = timer.status === "idle"
  const formatted = formatDuration(remainingMs)
  const customSelected = rest.mode === "custom"
  const pauseResumeLabel = isPaused ? RESUME_LABEL : PAUSE_LABEL

  // Collapsed on load so the first exercise stays above the fold on a phone.
  // The panel is only hidden, never unmounted: a draft typed into a seconds
  // field and the running countdown survive closing it.
  const [settingsOpen, setSettingsOpen] = useState(false)
  const customInputRef = useRef<HTMLInputElement>(null)
  // Bumped by «Своё время» so the focus lands after the panel is on screen.
  const [focusTicket, setFocusTicket] = useState(0)
  useEffect(() => {
    if (focusTicket === 0) return
    customInputRef.current?.focus()
    customInputRef.current?.select()
  }, [focusTicket])

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-xl border border-border bg-muted px-3 py-3 sm:px-4"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2
          id={headingId}
          className="flex items-center gap-2 text-[0.9rem] font-semibold sm:text-[0.95rem]"
        >
          <Timer aria-hidden="true" className="size-4 shrink-0 translate-y-px text-muted-foreground" />
          Отдых
        </h2>
        {/* Which countdown this is, so a 03:00 rest is never a mystery. */}
        <p className="text-[13px] text-muted-foreground" aria-live="polite">
          {REST_KIND_LABELS[timer.kind]}
        </p>
        <p className="ml-auto text-[13px] text-muted-foreground" aria-live="polite">
          {timerEnabled ? TIMER_STATUS_LABELS[timer.status] : TIMER_DISABLED_LABEL}
        </p>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <p
          role="timer"
          aria-live="off"
          aria-label={`Осталось ${formatted}`}
          className="text-[2.75rem] leading-none font-semibold tabular-nums"
        >
          {formatted}
        </p>
        {/* Icon-only: the labels live in aria-label and title, so the row stays
            compact without losing the accessible names. */}
        <div className="ml-auto grid shrink-0 grid-cols-2 gap-2">
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="size-11"
            aria-label={pauseResumeLabel}
            title={pauseResumeLabel}
            disabled={isIdle || timer.status === "finished"}
            onClick={onPauseResume}
          >
            {isPaused ? (
              <Play aria-hidden="true" className="size-5" />
            ) : (
              <Pause aria-hidden="true" className="size-5" />
            )}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="size-11"
            aria-label={SKIP_LABEL}
            title={SKIP_LABEL}
            disabled={isIdle}
            onClick={onSkip}
          >
            <SkipForward aria-hidden="true" className="size-5" />
          </Button>
        </div>
      </div>

      <div
        role="group"
        aria-label="Длительность отдыха между подходами"
        className="mt-3 grid grid-cols-3 gap-1.5"
      >
        {REST_PRESETS.map((seconds) => {
          const selected = !customSelected && rest.presetSeconds === seconds
          return (
            <Button
              key={seconds}
              type="button"
              variant="secondary"
              aria-pressed={selected}
              onClick={() => onSelectDuration(seconds, { mode: "preset" })}
              className={cn(
                "h-10 min-w-0 px-1 text-sm font-normal",
                selected && "border-selected text-foreground"
              )}
            >
              {seconds} с
            </Button>
          )
        })}
        <Button
          type="button"
          variant="secondary"
          aria-pressed={customSelected}
          onClick={() => {
            onSelectDuration(rest.customSeconds, { mode: "custom" })
            // Picking «Своё время» is a request to edit it: reveal the field.
            setSettingsOpen(true)
            setFocusTicket((ticket) => ticket + 1)
          }}
          className={cn(
            "h-10 min-w-0 px-1 text-sm font-normal",
            customSelected && "border-selected text-foreground"
          )}
        >
          {CUSTOM_REST_LABEL}
        </Button>
      </div>

      <div className="mt-2 flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1">
        <Checkbox
          id={timerId}
          checked={timerEnabled}
          onCheckedChange={(checked) => onTimerEnabledChange(checked === true)}
          className="data-checked:border-success data-checked:bg-success data-checked:text-success-foreground"
        />
        <Label htmlFor={timerId} className="font-normal">
          {TIMER_SWITCH_LABEL}
        </Label>
        <Button
          type="button"
          variant="secondary"
          aria-expanded={settingsOpen}
          aria-controls={settingsId}
          onClick={() => setSettingsOpen((open) => !open)}
          className="ml-auto h-10 px-3 text-sm font-normal"
        >
          {REST_SETTINGS_LABEL}
          <ChevronDown
            aria-hidden="true"
            className={cn("size-4", settingsOpen && "rotate-180")}
          />
        </Button>
      </div>

      <div id={settingsId} hidden={!settingsOpen} className="mt-3 flex flex-col gap-3">
        <SecondsField
          label={CUSTOM_REST_FIELD_LABEL}
          committed={rest.customSeconds}
          applyLabel={APPLY_LABEL}
          inputRef={customInputRef}
          onApply={(seconds) => onSelectDuration(seconds, { mode: "custom" })}
        />
        <SecondsField
          label={EXERCISE_REST_FIELD_LABEL}
          committed={rest.exerciseSeconds}
          applyLabel={APPLY_LABEL}
          onApply={(seconds) => onSelectDuration(seconds, { kind: "exercise" })}
        />
        <div className="flex min-h-11 flex-wrap items-center gap-2">
          <Checkbox
            id={soundId}
            checked={soundEnabled}
            disabled={!audioSupported}
            onCheckedChange={(checked) => onSoundChange(checked === true)}
            className="data-checked:border-success data-checked:bg-success data-checked:text-success-foreground"
          />
          <Label htmlFor={soundId} className="font-normal">
            Звуковой сигнал в конце отдыха
          </Label>
          {!audioSupported && (
            <span className="text-xs text-muted-foreground">
              — браузер не поддерживает воспроизведение звука
            </span>
          )}
        </div>
      </div>

      {alarmActive && (
        <Button
          type="button"
          onClick={onStopAlarm}
          className="mt-3 h-11 w-full font-normal"
        >
          {STOP_ALARM_LABEL}
        </Button>
      )}

      <p role="status" aria-live="assertive" className="min-h-5 text-center text-sm">
        {alarmActive && "Сигнал звучит — нажми «Остановить сигнал»."}
      </p>
    </section>
  )
}
