"use client"

import { Timer } from "lucide-react"
import { useId } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { REST_PRESETS } from "@/lib/workout-plan"
import { TIMER_STATUS_LABELS, formatDuration, type TimerState } from "@/lib/workout-state"

interface RestTimerProps {
  timer: TimerState
  /** Milliseconds left, already derived from the deadline by the parent. */
  remainingMs: number
  soundEnabled: boolean
  audioSupported: boolean
  onSelectDuration: (seconds: number) => void
  onPauseResume: () => void
  onSkip: () => void
  onSoundChange: (enabled: boolean) => void
}

export function RestTimer({
  timer,
  remainingMs,
  soundEnabled,
  audioSupported,
  onSelectDuration,
  onPauseResume,
  onSkip,
  onSoundChange,
}: RestTimerProps) {
  const headingId = useId()
  const soundId = useId()

  const isPaused = timer.status === "paused"
  const isIdle = timer.status === "idle"
  const formatted = formatDuration(remainingMs)

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-2xl bg-muted px-4 py-4 sm:px-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2
          id={headingId}
          className="flex items-center gap-2 text-[0.9rem] font-semibold sm:text-[0.95rem]"
        >
          <Timer aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          Отдых между подходами
        </h2>
        <p className="ml-auto text-[13px] text-muted-foreground sm:text-sm" aria-live="polite">
          {TIMER_STATUS_LABELS[timer.status]}
        </p>
      </div>

      <p
        role="timer"
        aria-live="off"
        aria-label={`Осталось ${formatted}`}
        className="py-5 text-center text-5xl leading-none font-semibold tabular-nums sm:text-6xl"
      >
        {formatted}
      </p>

      <div
        role="group"
        aria-label="Длительность отдыха"
        className="grid grid-cols-4 gap-2"
      >
        {REST_PRESETS.map((seconds) => {
          const selected = timer.durationSeconds === seconds
          return (
            <Button
              key={seconds}
              type="button"
              variant="secondary"
              aria-pressed={selected}
              onClick={() => onSelectDuration(seconds)}
              className={cn(
                "h-10 min-w-0 px-1 text-sm font-normal",
                selected && "border-selected text-foreground"
              )}
            >
              {seconds} с
            </Button>
          )
        })}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="secondary"
          className="h-10 font-normal"
          disabled={isIdle || timer.status === "finished"}
          onClick={onPauseResume}
        >
          {isPaused ? "Продолжить" : "Пауза"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="h-10 font-normal"
          disabled={isIdle}
          onClick={onSkip}
        >
          Пропустить
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
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
    </section>
  )
}
