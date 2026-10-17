"use client"

import { Library } from "lucide-react"
import { useEffect, useState } from "react"

import { SavedWorkoutEditor } from "@/components/saved-workout-editor"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { savedWorkouts, type SavedWorkout, type StorageResult } from "@/lib/saved-workouts"
import {
  blankForm,
  copyForm,
  formFromDraft,
  formsEqual,
  storageErrorMessage,
  validateForm,
  type FormErrors,
  type WorkoutForm,
} from "@/lib/workout-editor"
import { WORKOUTS, WORKOUT_IDS } from "@/lib/workout-plan"
import { isPristine, setsFor, workoutOf, type WorkoutState } from "@/lib/workout-state"

export const LIBRARY_BUTTON_LABEL = "Мои тренировки"

interface Editing {
  /** Set when editing an existing workout; absent for a new one. */
  id?: SavedWorkout["id"]
  initial: WorkoutForm
  form: WorkoutForm
  errors: FormErrors | null
  saveError: string | null
}

type Discard = "close" | "cancel" | null

interface SavedWorkoutsPanelProps {
  /** Needed to copy "the current workout" and to know whether a start replaces progress. */
  state: WorkoutState
  /** Receives the newest catalog version, after any confirmation. */
  onStart: (workout: SavedWorkout) => void
}

/** Draft of what the session is doing right now, with the edits made to it. */
function currentForm(state: WorkoutState): WorkoutForm {
  const workout = workoutOf(state)
  const form = copyForm(workout)
  return {
    ...form,
    restSeconds: state.timer.durationSeconds,
    soundEnabled: state.soundEnabled,
    exercises: form.exercises.map((item, index) => {
      const exercise = workout.exercises[index]
      return {
        ...item,
        sets: String(setsFor(state, exercise)),
        reps: state.reps[exercise.id] ?? item.reps,
        weight: state.weights[exercise.id] ?? item.weight,
      }
    }),
  }
}

export function SavedWorkoutsPanel({ state, onStart }: SavedWorkoutsPanelProps) {
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<StorageResult<SavedWorkout[]> | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null)
  const [pendingStart, setPendingStart] = useState<SavedWorkout | null>(null)
  const [pendingDelete, setPendingDelete] = useState<SavedWorkout | null>(null)
  const [discard, setDiscard] = useState<Discard>(null)

  const dirty = editing !== null && !formsEqual(editing.form, editing.initial)

  // An unsaved draft must survive an accidental reload/tab close prompt.
  useEffect(() => {
    if (!dirty) return
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", guard)
    return () => window.removeEventListener("beforeunload", guard)
  }, [dirty])

  const reload = () => setCatalog(savedWorkouts.list())

  const openEditor = (form: WorkoutForm, id?: SavedWorkout["id"]) => {
    setNotice(null)
    setEditing({ id, initial: form, form, errors: null, saveError: null })
  }

  const leaveEditor = () => {
    setEditing(null)
    setDiscard(null)
  }

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setNotice(null)
      reload()
      setOpen(true)
      return
    }
    // Escape / overlay / close must not silently drop a dirty draft.
    if (dirty) {
      setDiscard("close")
      return
    }
    setEditing(null)
    setOpen(false)
  }

  const handleCancelEditor = () => {
    if (dirty) setDiscard("cancel")
    else leaveEditor()
  }

  const confirmDiscard = () => {
    if (discard === "close") setOpen(false)
    leaveEditor()
  }

  const handleSave = () => {
    if (!editing) return
    const checked = validateForm(editing.form)
    if ("errors" in checked) {
      setEditing({ ...editing, errors: checked.errors, saveError: null })
      return
    }
    const result = editing.id
      ? savedWorkouts.update(editing.id, checked.draft)
      : savedWorkouts.create(checked.draft)
    if (!result.ok) {
      // The draft stays exactly as typed so the user can retry.
      setEditing({ ...editing, errors: null, saveError: storageErrorMessage(result) })
      return
    }
    setEditing(null)
    setNotice({ kind: "ok", text: `Тренировка «${result.value.title}» сохранена.` })
    reload()
  }

  const startConfirmed = (workout: SavedWorkout) => {
    // Always the newest saved version, not whatever the list showed earlier.
    const latest = savedWorkouts.get(workout.id)
    if (!latest.ok) {
      setNotice({ kind: "error", text: `Не удалось запустить: ${storageErrorMessage(latest)}` })
      reload()
      return
    }
    setOpen(false)
    onStart(latest.value)
  }

  const requestStart = (workout: SavedWorkout) => {
    if (isPristine(state)) startConfirmed(workout)
    else setPendingStart(workout)
  }

  const confirmDelete = (workout: SavedWorkout) => {
    const result = savedWorkouts.remove(workout.id)
    if (result.ok) setNotice({ kind: "ok", text: `Тренировка «${workout.title}» удалена.` })
    else setNotice({ kind: "error", text: `Не удалось удалить: ${storageErrorMessage(result)}` })
    reload()
  }

  const items = catalog?.ok ? catalog.value : []
  const runningId = state.snapshot?.id ?? null

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button type="button" variant="secondary" className="h-11 w-full px-3 font-normal">
            <Library aria-hidden="true" className="size-4" />
            {LIBRARY_BUTTON_LABEL}
          </Button>
        </DialogTrigger>
        <DialogContent aria-describedby={undefined} className="max-h-[90dvh]">
          <DialogHeader>
            <DialogTitle>
              {editing ? (editing.id ? "Редактирование тренировки" : "Новая тренировка") : LIBRARY_BUTTON_LABEL}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Изменения не применяются к уже запущенной тренировке."
                : "Сохранённые тренировки хранятся только в этом браузере и могут исчезнуть после очистки его данных."}
            </DialogDescription>
          </DialogHeader>

          {editing ? (
            <>
              <DialogBody>
                <SavedWorkoutEditor
                  form={editing.form}
                  errors={editing.errors}
                  saveError={editing.saveError}
                  onChange={(form) => setEditing({ ...editing, form, errors: null })}
                />
              </DialogBody>
              <DialogFooter>
                <Button type="button" className="h-11 grow px-3" onClick={handleSave}>
                  Сохранить
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11 grow px-3 font-normal"
                  onClick={handleCancelEditor}
                >
                  Отмена
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogBody className="flex flex-col gap-4">
                {notice && (
                  <p
                    role={notice.kind === "error" ? "alert" : "status"}
                    className={notice.kind === "error" ? "text-sm text-destructive" : "text-sm text-success"}
                  >
                    {notice.text}
                  </p>
                )}

                {catalog === null ? null : !catalog.ok ? (
                  <div role="alert" className="flex flex-col gap-2 text-sm text-destructive">
                    <p>Не удалось загрузить тренировки: {storageErrorMessage(catalog)}</p>
                    <Button type="button" variant="secondary" className="h-11 px-3" onClick={reload}>
                      Повторить
                    </Button>
                  </div>
                ) : items.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Пока нет сохранённых тренировок. Создайте первую ниже.
                  </p>
                ) : (
                  <ul aria-label="Сохранённые тренировки" className="flex list-none flex-col gap-3 p-0">
                    {items.map((workout) => (
                      <li key={workout.id} className="rounded-xl border border-border p-3">
                        <p className="font-semibold break-words">{workout.title}</p>
                        <p className="text-sm text-muted-foreground break-words">
                          {workout.label} · упражнений: {workout.exercises.length}
                          {runningId === workout.id ? " · идёт сейчас" : ""}
                        </p>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <Button
                            type="button"
                            className="h-11 px-2"
                            aria-label={`Запустить ${workout.title}`}
                            onClick={() => requestStart(workout)}
                          >
                            Запустить
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            className="h-11 px-2 font-normal"
                            aria-label={`Изменить ${workout.title}`}
                            onClick={() => openEditor(formFromDraft(workout), workout.id)}
                          >
                            Изменить
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            className="h-11 px-2 font-normal"
                            aria-label={`Копировать ${workout.title}`}
                            onClick={() => openEditor(copyForm(workout))}
                          >
                            Копировать
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            className="h-11 px-2"
                            aria-label={`Удалить ${workout.title}`}
                            onClick={() => setPendingDelete(workout)}
                          >
                            Удалить
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <section aria-label="Создать тренировку" className="flex flex-col gap-2">
                  <h3 className="font-semibold">Создать</h3>
                  <Button
                    type="button"
                    className="h-11 px-3"
                    disabled={catalog !== null && !catalog.ok}
                    onClick={() => openEditor(blankForm())}
                  >
                    Новая пустая тренировка
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-11 px-3 font-normal"
                    disabled={catalog !== null && !catalog.ok}
                    onClick={() => openEditor(currentForm(state))}
                  >
                    Копия текущей тренировки
                  </Button>
                  <div className="grid grid-cols-3 gap-2">
                    {WORKOUT_IDS.map((id) => (
                      <Button
                        key={id}
                        type="button"
                        variant="secondary"
                        className="min-h-11 px-1 text-[13px] font-normal"
                        aria-label={`Копия встроенной: ${WORKOUTS[id].label}`}
                        disabled={catalog !== null && !catalog.ok}
                        onClick={() => openEditor(copyForm(WORKOUTS[id]))}
                      >
                        {WORKOUTS[id].label}
                      </Button>
                    ))}
                  </div>
                </section>
              </DialogBody>
              <DialogFooter>
                <Button
                  type="button"
                  variant="secondary"
                  className="h-11 grow px-3 font-normal"
                  onClick={() => handleOpenChange(false)}
                >
                  Закрыть
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingStart !== null}
        onOpenChange={(next) => {
          if (!next) setPendingStart(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingStart && pendingStart.id === runningId
                ? `Перезапустить «${pendingStart.title}»?`
                : `Запустить «${pendingStart?.title ?? ""}»?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingStart && pendingStart.id === runningId
                ? "Тренировка начнётся заново по последней сохранённой версии. "
                : ""}
              Текущий прогресс, изменённые веса и повторения, таймер и настройки будут сброшены.
              Продолжить?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingStart) startConfirmed(pendingStart)
              }}
            >
              Запустить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => {
          if (!next) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить «{pendingDelete?.title ?? ""}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Сохранённая тренировка будет удалена без возможности восстановления. Уже идущая
              тренировка не изменится.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete) confirmDelete(pendingDelete)
              }}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={discard !== null}
        onOpenChange={(next) => {
          if (!next) setDiscard(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отменить изменения?</AlertDialogTitle>
            <AlertDialogDescription>
              Несохранённые изменения будут потеряны.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Продолжить редактирование</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDiscard}>Отменить изменения</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
