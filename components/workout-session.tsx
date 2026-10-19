"use client"

import { Dumbbell } from "lucide-react"
import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react"

import { ExerciseCard } from "@/components/exercise-card"
import { RestTimer } from "@/components/rest-timer"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { SavedWorkoutsPanel } from "@/components/saved-workouts-panel"
import { WorkoutInfo } from "@/components/workout-info"
import { WorkoutSelector } from "@/components/workout-selector"
import { isAudioSupported, startAlarm, stopAlarm, unlockAudio } from "@/lib/beep"
import { type SavedWorkout } from "@/lib/saved-workouts"
import { isWorkoutId, type WorkoutId } from "@/lib/workout-plan"
import { RestAudio, FRESH_ALARM_MS, type RestAudioStatus } from "@/lib/rest-audio"
import { type RestKind, type RestSettings, type WorkoutAction } from "@/lib/workout-state"
import {
  buildResultsText,
  countCompleted,
  createInitialState,
  elapsedMs,
  formatClock,
  hiddenCompletedFor,
  isClockRunning,
  isPristine,
  isWorkoutComplete,
  progressPercent,
  remainingMs as selectRemainingMs,
  setsFor,
  totalSets,
  workoutOf,
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

export const WORKOUT_CLOCK_LABEL = "Время тренировки"

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
  const [audioSupported] = useState(() => (hydrated ? isAudioSupported() || typeof Audio !== "undefined" : true))
  const [copyStatus, setCopyStatus] = useState<CopyStatus>({ kind: "idle" })
  // Transient UI only: whether the repeating alarm is sounding right now. It is
  // never persisted, so a reload never shows a stop button for an old rest.
  const [alarmActive, setAlarmActive] = useState(false)
  const lastBeepRef = useRef<number | null>(null)
  const [audioStatus, setAudioStatus] = useState<RestAudioStatus>("idle")
  const [restAudio] = useState(() => new RestAudio(setAudioStatus))

  // play() must happen inside the gesture, not in a React effect.
  const dispatchTimer = useCallback((action: WorkoutAction) => {
    const next = workoutReducer(state, action)
    if (next.soundEnabled && next.timer.status === "running" && next.timer.deadline !== null) {
      restAudio.start(next.timer.deadline)
    } else {
      restAudio.stop()
    }
    dispatch(action)
  }, [state, restAudio])

  // A failed write flips a flag inside the storage module and notifies here,
  // so the warning appears without any effect calling setState.
  const storageAvailable = useSyncExternalStore(
    subscribeStorageHealth,
    getStorageHealthSnapshot,
    getServerStorageHealthSnapshot
  )

  const workout = workoutOf(state)

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
  const clockRunning = isClockRunning(state)
  useEffect(() => {
    if (state.timer.status !== "running" && audioStatus !== "playing" && !clockRunning) return

    // `now` is already current whenever a timer starts: every path that starts
    // one sets it from the click handler, and a restored one seeds it above.
    const sync = () => {
      restAudio.reconcile()
      setNow(Date.now())
    }
    const interval = window.setInterval(sync, TICK_INTERVAL_MS)
    // Coming back to a throttled/hidden tab must snap straight to the truth.
    document.addEventListener("visibilitychange", sync)
    window.addEventListener("focus", sync)
    window.addEventListener("pageshow", sync)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", sync)
      window.removeEventListener("focus", sync)
      window.removeEventListener("pageshow", sync)
    }
  }, [state.timer.status, restAudio, audioStatus, clockRunning])

  const { deadline, status } = state.timer
  useEffect(() => {
    if (status !== "running" || deadline === null) return
    if (now < deadline) return
    dispatch({ type: "tick", now: Date.now() })
  }, [now, status, deadline])

  // --- alarm --------------------------------------------------------------
  /** Silence the alarm and hide its stop button. Safe to call when idle. */
  const silenceAlarm = useCallback(() => {
    stopAlarm()
    restAudio.stop()
    setAlarmActive(false)
  }, [restAudio])

  // The reducer only sets `beepAt` for a rest that ended naturally while sound
  // was on, so a muted session and a restored expired timer stay silent.
  useEffect(() => {
    if (state.beepAt === null) return
    if (lastBeepRef.current === state.beepAt) return
    lastBeepRef.current = state.beepAt
    restAudio.reconcile()
    if (restAudio.ownsDeadline(state.beepAt)) return
    if (Date.now() - state.beepAt <= FRESH_ALARM_MS) {
      // Reflect the external audio engine's actual synchronous result. Pending
      // resume reports success separately, never via an optimistic stop button.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAlarmActive(startAlarm(() => setAlarmActive(true), state.beepAt + FRESH_ALARM_MS))
    }
  }, [state.beepAt, restAudio])

  // Leaving the page must not leave oscillators or a repeat timer behind.
  useEffect(() => () => { stopAlarm(true); restAudio.stop() }, [restAudio])

  // --- handlers -----------------------------------------------------------
  const handleToggleSet = useCallback((exerciseId: string, setIndex: number) => {
    // This click is a user gesture, so it is a valid moment to unlock audio for
    // the rest it is about to start.
    unlockAudio()
    // A new set means a new countdown: the previous rest's alarm is over.
    silenceAlarm()
    dispatchTimer({ type: "toggle-set", exerciseId, setIndex, now: Date.now() })
    setNow(Date.now())
  }, [silenceAlarm, dispatchTimer])

  const handleSelectDuration = useCallback(
    (seconds: number, options?: { kind?: RestKind; mode?: RestSettings["mode"] }) => {
      unlockAudio()
      silenceAlarm()
      dispatchTimer({ type: "select-duration", seconds, now: Date.now(), ...options })
      setNow(Date.now())
    },
    [silenceAlarm, dispatchTimer]
  )

  const handleTimerEnabledChange = useCallback(
    (enabled: boolean) => {
      if (enabled) unlockAudio()
      // Switching the timer off must cut a sounding alarm off at once; switching
      // it back on must not start a countdown or a sound.
      silenceAlarm()
      dispatchTimer({ type: "set-timer-enabled", enabled })
    },
    [silenceAlarm, dispatchTimer]
  )

  const handlePauseResume = useCallback(() => {
    unlockAudio()
    const timestamp = Date.now()
    dispatchTimer(
      state.timer.status === "paused"
        ? { type: "resume", now: timestamp }
        : { type: "pause", now: timestamp }
    )
    setNow(timestamp)
  }, [state.timer.status, dispatchTimer])

  const handleSkip = useCallback(() => {
    silenceAlarm()
    dispatchTimer({ type: "skip" })
  }, [silenceAlarm, dispatchTimer])

  const handleSoundChange = useCallback(
    (enabled: boolean) => {
      if (enabled) unlockAudio()
      // Unticking the box must cut a sounding alarm off at once; ticking it
      // back on must not start one.
      silenceAlarm()
      dispatchTimer({ type: "set-sound", enabled })
    },
    [silenceAlarm, dispatchTimer]
  )

  const handleReset = useCallback(() => {
    silenceAlarm()
    dispatchTimer({ type: "reset" })
    lastBeepRef.current = null
    setCopyStatus({ kind: "idle" })
  }, [silenceAlarm, dispatchTimer])

  /** Already confirmed by the selector; starts the chosen workout from scratch. */
  const handleSelectWorkout = useCallback((workoutId: WorkoutId) => {
    silenceAlarm()
    dispatchTimer({ type: "select-workout", workoutId })
    // The new session has an idle timer, so the clock interval stops on its own;
    // forgetting the last beep keeps a finished rest from sounding again.
    lastBeepRef.current = null
    setCopyStatus({ kind: "idle" })
    setNow(Date.now())
  }, [silenceAlarm, dispatchTimer])

  /** Already confirmed by the library; starts the saved workout from scratch. */
  const handleStartSaved = useCallback((saved: SavedWorkout) => {
    silenceAlarm()
    dispatch({ type: "start-saved-workout", workout: saved })
    lastBeepRef.current = null
    setCopyStatus({ kind: "idle" })
    setNow(Date.now())
  }, [silenceAlarm])

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
  const total = totalSets(state)
  const percent = progressPercent(state)
  const complete = isWorkoutComplete(state)
  const remaining = selectRemainingMs(state.timer, now)
  // Absolute-timestamp based, so it survives rests, pauses, a switched-off
  // timer, a background tab and a reload, and freezes on the final set.
  const elapsed = formatClock(elapsedMs(state, now))
  // Marks parked beyond the chosen set count: explained in the ⓘ panel, since
  // the cards no longer carry prose.
  const hiddenMarks = workout.exercises
    .map((exercise) => ({
      id: exercise.id,
      name: exercise.name,
      count: hiddenCompletedFor(state, exercise),
    }))
    .filter((entry) => entry.count > 0)

  return (
    <main className="mx-auto w-full max-w-[560px] px-4 py-5 sm:py-8">
      <header className="flex flex-col gap-2.5">
        <WorkoutSelector
          selected={isWorkoutId(state.workoutId) ? state.workoutId : null}
          onSelect={handleSelectWorkout}
        />

        {/* One toolbar row: the library, and the ⓘ button that holds every
            explanation the page used to spell out. */}
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <SavedWorkoutsPanel state={state} onStart={handleStartSaved} />
          </div>
          <WorkoutInfo workout={workout} hiddenMarks={hiddenMarks} />
        </div>

        <h1 className="flex items-center gap-2 text-base leading-snug font-semibold sm:text-lg">
          <Dumbbell aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          {workout.title}
        </h1>
      </header>

      <section aria-label="Общий прогресс" className="mt-3 flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="flex items-baseline gap-1.5">
            <span className="text-lg font-semibold tabular-nums" aria-live="polite">
              {completed} / {total}
            </span>
            <span className="text-xs text-muted-foreground">подходов</span>
            <span className="text-xs text-muted-foreground" aria-hidden="true">
              ·
            </span>
            <span className="text-xs text-muted-foreground tabular-nums" aria-hidden="true">
              {percent}%
            </span>
          </p>
          <p className="flex items-baseline gap-1.5">
            <span className="text-xs text-muted-foreground">{WORKOUT_CLOCK_LABEL}</span>
            <span
              className="text-lg font-semibold tabular-nums"
              aria-label={`${WORKOUT_CLOCK_LABEL}: ${elapsed}`}
            >
              {elapsed}
            </span>
          </p>
        </div>
        <Progress
          value={percent}
          aria-label={`Прогресс тренировки: ${percent}%`}
          className="h-1.5 bg-secondary [&_[data-slot=progress-indicator]]:bg-success"
        />
      </section>

      <div className="mt-3">
        <RestTimer
          timer={state.timer}
          remainingMs={remaining}
          rest={state.rest}
          timerEnabled={state.timerEnabled}
          soundEnabled={state.soundEnabled}
          audioSupported={audioSupported}
          onSelectDuration={handleSelectDuration}
          onPauseResume={handlePauseResume}
          onSkip={handleSkip}
          onSoundChange={handleSoundChange}
          onTimerEnabledChange={handleTimerEnabledChange}
          alarmActive={alarmActive || restAudio.isAlarm(now)}
          onStopAlarm={silenceAlarm}
        />
        {/* The passive note about background audio now lives in the ⓘ panel;
            only the actionable warning stays on the page. */}
        {(audioStatus === "blocked" || audioStatus === "interrupted") && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            Браузер остановил звук или запретил его запуск. Таймер продолжает идти.
            Чтобы снова включить звук во время отдыха, нажми «Пауза», затем «Продолжить».
          </p>
        )}
      </div>

      {complete && (
        <p
          role="status"
          className="mt-4 rounded-xl border border-success bg-success-muted px-4 py-3 text-sm"
        >
          Тренировка завершена — отмечены все {total} подходов. Отличная работа!
        </p>
      )}

      <ol className="mt-4 flex list-none flex-col gap-2.5 p-0">
        {workout.exercises.map((exercise, index) => (
          <li key={exercise.id}>
            <ExerciseCard
              exercise={exercise}
              index={index}
              sets={setsFor(state, exercise)}
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
              onSetsChange={(count) =>
                dispatch({ type: "set-sets", exerciseId: exercise.id, count })
              }
            />
          </li>
        ))}
      </ol>

      {/* grow + wrap: side by side when both fit, full width each when they do not. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
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

      {/* Actionable, so it stays on the page rather than hiding in the ⓘ panel. */}
      {!storageAvailable && (
        <footer className="mt-4 text-sm leading-relaxed">
          <p className="text-destructive">
            Браузер запретил локальное хранилище — прогресс не сохранится после перезагрузки
            страницы.
          </p>
        </footer>
      )}

    </main>
  )
}
