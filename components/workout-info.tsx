"use client"

import { Info } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ROTATION_NOTE, type Workout } from "@/lib/workout-plan"

export const INFO_BUTTON_LABEL = "Информация о тренировке"

export interface HiddenMark {
  id: string
  name: string
  /** Marks parked beyond the chosen set count. */
  count: number
}

interface WorkoutInfoProps {
  /** The running workout; every section below is read from it. */
  workout: Workout
  /** Exercises that currently hold marks beyond their chosen set count. */
  hiddenMarks: readonly HiddenMark[]
}

/**
 * Everything explanatory about the page, behind one ⓘ button: the page itself
 * keeps only controls, numbers and notices. Opening it is pure presentation —
 * it dispatches nothing, so progress, storage and the rest timer are untouched.
 */
export function WorkoutInfo({ workout, hiddenMarks }: WorkoutInfoProps) {
  const hints = workout.exercises.filter((exercise) => exercise.hint)
  const ranges = workout.exercises.filter((exercise) => exercise.setOptions)

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          aria-label={INFO_BUTTON_LABEL}
          className="size-11 shrink-0 p-0"
        >
          <Info aria-hidden="true" className="size-5" />
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{INFO_BUTTON_LABEL}</DialogTitle>
          <DialogDescription>
            {workout.title} — {workout.description}. {ROTATION_NOTE}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4 text-sm leading-relaxed text-muted-foreground">
          <section className="flex flex-col gap-2">
            <h3 className="font-semibold text-foreground">Как отмечать</h3>
            <p>
              Отмечай каждый выполненный подход. Прогресс пересчитывается автоматически.
              Вес и количество повторений можно менять прямо во время тренировки.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="font-semibold text-foreground">Таймер отдыха</h3>
            <p>
              Таймер запускается автоматически после каждого отмеченного подхода, кроме
              последнего. Звуковой сигнал работает, пока страница открыта.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="font-semibold text-foreground">Сброс и смена тренировки</h3>
            <p>
              «Начать заново» сбрасывает текущую тренировку. Смена тренировки начинает
              выбранный день с нуля — прогресс, веса, повторения, таймер и настройки
              сбрасываются после подтверждения.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="font-semibold text-foreground">Хранение данных</h3>
            <p>
              Данные хранятся только в этом браузере, на сервер ничего не отправляется.
              Браузер хранит только одну, текущую тренировку. Если очистить данные
              браузера, прогресс и настройки будут удалены.
            </p>
          </section>

          {ranges.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="font-semibold text-foreground">Выбор числа подходов</h3>
              <ul className="flex list-none flex-col gap-1 p-0">
                {ranges.map((exercise) => {
                  const options = exercise.setOptions!
                  return (
                    <li key={exercise.id}>
                      {exercise.name}: по плану {options[0]}–{options[options.length - 1]}{" "}
                      подхода.
                    </li>
                  )
                })}
              </ul>
              {hiddenMarks.length > 0 && (
                <ul className="flex list-none flex-col gap-1 p-0">
                  {hiddenMarks.map((entry) => (
                    <li key={entry.id}>
                      {entry.name}: отмечено подходов сверх выбранных — {entry.count}.
                    </li>
                  ))}
                </ul>
              )}
              <p>
                Если понизить число подходов, уже отмеченные сверх выбранного подходы
                перестают учитываться в прогрессе, но отметки сохраняются и снова зачтутся,
                когда вернёшь большее число подходов.
              </p>
            </section>
          )}

          {hints.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="font-semibold text-foreground">Техника упражнений</h3>
              <ul className="flex list-none flex-col gap-1 p-0">
                {hints.map((exercise) => (
                  <li key={exercise.id}>
                    {exercise.name}: {exercise.hint}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </DialogBody>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary" className="h-11 grow px-3 font-normal">
              Закрыть
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
