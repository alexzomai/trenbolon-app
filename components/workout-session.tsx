"use client"

import { Dumbbell } from "lucide-react"
import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react"

import { ExerciseCard } from "@/components/exercise-card"
import { RestTimer } from "@/components/rest-timer"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { isAudioSupported, playBeep, unlockAudio } from "@/lib/beep"
import { EXERCISES, TOTAL_SETS, WORKOUT_TITLE } from "@/lib/workout-plan"
import {
  buildResultsText,
  countCompleted,
  createInitialState,
  isPristine,
  isWorkoutComplete,
  progressPercent,
  remainingMs as selectRemainingMs,
  workoutReducer,
} from "@/lib/workout-state"
import {
  clearState,
  getServerStorageHealthSnapshot,
  getStorageHealthSnapshot,
  loadOrCreateState,
  saveState,
  subscribeStorageHealth,
} from "@/lib/workout-storage"

type CopyStatus = { kind: "idle" } | { kind: "ok" } | { kind: "error"; message: string }

/** How often the running clock is re-read. Display granularity only — the
 *  timer itself is deadline-based, so a throttled tab stays correct. */
const TICK_INTERVAL_MS = 250

export interface WorkoutSessionProps {
  /**
   * `false` for the server-rendered pass, `true` once the client owns the
   * tree. `WorkoutTracker` re-keys this component on the flip, so the client
   * instance can read localStorage, the clock and Web Audio support straight
   * from its own initializers — no post-mount state patching.
   */
  hydrated: boolean
}

export function WorkoutSession({ hydrated }: WorkoutSessionProps) {
  // Restoring here rather than in an effect means the very first client render
  // already shows the saved workout: no default-state flash, no cascading
  // render, and nothing can overwrite storage before it has been read.
  const [state, dispatch] = useReducer(workoutReducer, hydrated, (canRestore) =>
    canRestore ? loadOrCreateState(Date.now()) : createInitialState()
  )
  const [now, setNow] = useState(() => (hydrated ? Date.now() : 0))
  // Fixed for the lifetime of the instance; optimistic on the server so the
  // prerendered HTML never claims audio is missing.
  const [audioSupported] = useState(() => (hydrated ? isAudioSupported() : true))
  const [copyStatus, setCopyStatus] = useState<CopyStatus>({ kind: "idle" })
  const lastBeepRef = useRef<number | null>(null)

  // A failed write flips a flag inside the storage module and notifies here,
  // so the warning appears without any effect calling setState.
  const storageAvailable = useSyncExternalStore(
    subscribeStorageHealth,
    getStorageHealthSnapshot,
    getServerStorageHealthSnapshot
  )

  // --- persist ------------------------------------------------------------
  useEffect(() => {
    // The server-rendered instance still mounts and runs effects during
    // hydration. It holds default state, so letting it write would clobber the
    // saved record a moment before the client instance reads it.
    if (!hydrated) return

    if (isPristine(state)) {
      // Nothing worth remembering: drop the record rather than storing defaults.
      clearState()
      return
    }
    saveState(state)
  }, [state, hydrated])

  // --- clock --------------------------------------------------------------
  useEffect(() => {
    if (state.timer.status !== "running") return

    // `now` is already current whenever a timer starts: every path that starts
    // one sets it from the click handler, and a restored one seeds it above.
    const sync = () => setNow(Date.now())
    const interval = window.setInterval(sync, TICK_INTERVAL_MS)
    // Coming back to a throttled/hidden tab must snap straight to the truth.
    document.addEventListener("visibilitychange", sync)
    window.addEventListener("focus", sync)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", sync)
      window.removeEventListener("focus", sync)
    }
  }, [state.timer.status])

  const { deadline, status } = state.timer
  useEffect(() => {
    if (status !== "running" || deadline === null) return
    if (now < deadline) return
    dispatch({ type: "tick", now: Date.now() })
  }, [now, status, deadline])

  // --- beep ---------------------------------------------------------------
  useEffect(() => {
    if (state.beepAt === null) return
    if (lastBeepRef.current === state.beepAt) return
    lastBeepRef.current = state.beepAt
    playBeep()
  }, [state.beepAt])

  // --- handlers -----------------------------------------------------------
  const handleToggleSet = useCallback((exerciseId: string, setIndex: number) => {
    // This click is a user gesture, so it is a valid moment to unlock audio for
    // the rest it is about to start.
    unlockAudio()
    dispatch({ type: "toggle-set", exerciseId, setIndex, now: Date.now() })
    setNow(Date.now())
  }, [])

  const handleSelectDuration = useCallback((seconds: number) => {
    unlockAudio()
    dispatch({ type: "select-duration", seconds, now: Date.now() })
    setNow(Date.now())
  }, [])

  const handlePauseResume = useCallback(() => {
    unlockAudio()
    const timestamp = Date.now()
    dispatch(
      state.timer.status === "paused"
        ? { type: "resume", now: timestamp }
        : { type: "pause", now: timestamp }
    )
    setNow(timestamp)
  }, [state.timer.status])

  const handleSkip = useCallback(() => {
    dispatch({ type: "skip" })
  }, [])

  const handleSoundChange = useCallback((enabled: boolean) => {
    if (enabled) unlockAudio()
    dispatch({ type: "set-sound", enabled })
  }, [])

  const handleReset = useCallback(() => {
    dispatch({ type: "reset" })
    clearState()
    lastBeepRef.current = null
    setCopyStatus({ kind: "idle" })
  }, [])

  const handleCopy = useCallback(async () => {
    const text = buildResultsText(state)
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("буфер обмена недоступен в этом браузере")
      }
      await navigator.clipboard.writeText(text)
      setCopyStatus({ kind: "ok" })
    } catch (error) {
      setCopyStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "неизвестная ошибка",
      })
    }
  }, [state])

  // --- derived ------------------------------------------------------------
  const completed = countCompleted(state)
  const percent = progressPercent(state)
  const complete = isWorkoutComplete(state)
  const remaining = selectRemainingMs(state.timer, now)

  return (
    <main className="mx-auto w-full max-w-[760px] px-4 py-8 sm:py-10">
      <header className="flex flex-col gap-3">
        <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
          <Dumbbell aria-hidden="true" className="size-5 shrink-0" />
          {WORKOUT_TITLE}
        </h1>
        <p className="text-[0.95rem] leading-relaxed text-muted-foreground">
          Отмечай каждый выполненный подход. Прогресс пересчитывается автоматически. Вес и
          количество повторений можно менять прямо во время тренировки.
        </p>
      </header>

      <section aria-label="Общий прогресс" className="mt-7 flex flex-col gap-2">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Выполнено подходов</p>
            <p className="text-2xl font-bold tabular-nums" aria-live="polite">
              {completed} / {TOTAL_SETS}
            </p>
          </div>
          <p className="text-2xl font-bold tabular-nums" aria-hidden="true">
            {percent}%
          </p>
        </div>
        <Progress
          value={percent}
          aria-label={`Прогресс тренировки: ${percent}%`}
          className="h-2 bg-secondary [&_[data-slot=progress-indicator]]:bg-success"
        />
      </section>

      <div className="mt-6">
        <RestTimer
          timer={state.timer}
          remainingMs={remaining}
          soundEnabled={state.soundEnabled}
          audioSupported={audioSupported}
          onSelectDuration={handleSelectDuration}
          onPauseResume={handlePauseResume}
          onSkip={handleSkip}
          onSoundChange={handleSoundChange}
        />
      </div>

      {complete && (
        <p
          role="status"
          className="mt-6 rounded-xl border border-success bg-success-muted px-4 py-3 text-sm"
        >
          Тренировка завершена — отмечены все {TOTAL_SETS} подходов. Отличная работа!
        </p>
      )}

      <ol className="mt-6 flex list-none flex-col gap-3 p-0">
        {EXERCISES.map((exercise, index) => (
          <li key={exercise.id}>
            <ExerciseCard
              exercise={exercise}
              index={index}
              marks={state.completed[exercise.id]}
              weight={state.weights[exercise.id]}
              reps={state.reps[exercise.id]}
              onToggleSet={(setIndex) => handleToggleSet(exercise.id, setIndex)}
              onWeightChange={(value) =>
                dispatch({ type: "set-weight", exerciseId: exercise.id, value })
              }
              onRepsChange={(value) =>
                dispatch({ type: "set-reps", exerciseId: exercise.id, value })
              }
            />
          </li>
        ))}
      </ol>

      {/* grow + wrap: side by side when both fit, full width each when they do not. */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          className="h-11 grow px-3 font-normal"
          onClick={handleCopy}
        >
          Скопировать результаты
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="h-11 grow px-3 font-normal"
          onClick={handleReset}
        >
          Начать заново
        </Button>
      </div>

      <p role="status" aria-live="polite" className="mt-3 min-h-5 text-sm">
        {copyStatus.kind === "ok" && (
          <span className="text-success">Результаты скопированы в буфер обмена.</span>
        )}
        {copyStatus.kind === "error" && (
          <span className="text-destructive">
            Не удалось скопировать результаты: {copyStatus.message}.
          </span>
        )}
      </p>

      <footer className="mt-6 flex flex-col gap-2 text-sm leading-relaxed text-muted-foreground">
        <p>
          Таймер запускается автоматически после каждого отмеченного подхода, кроме
          последнего.
        </p>
        <p>
          Данные хранятся только в этом браузере, на сервер ничего не отправляется. Если
          очистить данные браузера, прогресс и настройки будут удалены. Звуковой сигнал
          работает, пока страница открыта.
        </p>
        {!storageAvailable && (
          <p className="text-destructive">
            Браузер запретил локальное хранилище — прогресс не сохранится после перезагрузки
            страницы.
          </p>
        )}
      </footer>
    </main>
  )
}
