"use client"

import { Check, Circle } from "lucide-react"
import { useId } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import type { Exercise } from "@/lib/workout-plan"

interface ExerciseCardProps {
  exercise: Exercise
  index: number
  /** Set count in force, which may be fewer than `marks.length`. */
  sets: number
  /** One mark per slot; only the first `sets` of them count. */
  marks: boolean[]
  /** Marks parked beyond `sets`, kept so raising the count restores them. */
  hiddenDone: number
  weight: string
  reps: string
  onToggleSet: (setIndex: number) => void
  onWeightChange: (value: string) => void
  onRepsChange: (value: string) => void
  onSetsChange: (count: number) => void
}

/**
 * Columns for the set buttons. Four never fit side by side at 360 px, so they
 * wrap into two rows rather than losing height or being squeezed narrower.
 */
function columnsFor(sets: number): string {
  if (sets >= 4) return "grid-cols-2 sm:grid-cols-4"
  if (sets <= 2) return "grid-cols-2"
  return "grid-cols-3"
}

export function ExerciseCard({
  exercise,
  index,
  sets,
  marks,
  hiddenDone,
  weight,
  reps,
  onToggleSet,
  onWeightChange,
  onRepsChange,
  onSetsChange,
}: ExerciseCardProps) {
  const fieldId = useId()
  const weightId = `${fieldId}-weight`
  const repsId = `${fieldId}-reps`
  const setsLabelId = `${fieldId}-sets`

  const visible = marks.slice(0, sets)
  const done = visible.filter(Boolean).length
  const title = `${index + 1}. ${exercise.name}`

  const options = exercise.setOptions
  const notes = [
    exercise.hint,
    options && `по плану ${options[0]}–${options[options.length - 1]} подхода`,
  ].filter(Boolean)

  return (
    <Card
      size="sm"
      className="gap-3 rounded-xl bg-card ring-1 ring-border [--card-spacing:--spacing(3.5)]"
    >
      <CardHeader className="items-center gap-x-3">
        <CardTitle className="text-[0.95rem] leading-snug font-semibold">{title}</CardTitle>
        <CardAction className="self-center text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          <span>
            {sets} × {reps.trim() || "—"}
          </span>
          <span aria-hidden="true"> · </span>
          <span>
            <span className="sr-only">выполнено подходов: </span>
            {done}/{sets}
          </span>
        </CardAction>
        {notes.length > 0 && (
          <CardDescription className="text-xs leading-snug">
            {notes.join(" · ")}
          </CardDescription>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor={weightId} className="font-normal text-muted-foreground">
              Вес, кг
            </Label>
            <Input
              id={weightId}
              value={weight}
              onChange={(event) => onWeightChange(event.target.value)}
              placeholder="—"
              inputMode="text"
              autoComplete="off"
              aria-label={`Вес в кг, ${exercise.name}`}
              className="h-9 w-20 border-transparent bg-secondary text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor={repsId} className="font-normal text-muted-foreground">
              Повт.
            </Label>
            <Input
              id={repsId}
              value={reps}
              onChange={(event) => onRepsChange(event.target.value)}
              placeholder="—"
              inputMode="text"
              autoComplete="off"
              aria-label={`Количество повторений, ${exercise.name}`}
              className="h-9 w-20 border-transparent bg-secondary text-sm"
            />
          </div>
          {options && (
            <div className="flex items-center gap-2">
              <span id={setsLabelId} className="text-sm text-muted-foreground">
                Подходов
              </span>
              <ToggleGroup
                type="single"
                value={String(sets)}
                onValueChange={(value) => {
                  const count = Number(value)
                  if (options.includes(count)) onSetsChange(count)
                }}
                aria-labelledby={setsLabelId}
                className="gap-1"
              >
                {options.map((option) => (
                  <ToggleGroupItem
                    key={option}
                    value={String(option)}
                    aria-label={`${option} подхода`}
                    className="size-9 px-0 text-sm tabular-nums"
                  >
                    {option}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          )}
        </div>

        <div className={cn("grid gap-2", columnsFor(sets))}>
          {visible.map((isDone, setIndex) => (
            <Button
              key={setIndex}
              type="button"
              variant="secondary"
              aria-pressed={isDone}
              aria-label={`${exercise.name}, подход ${setIndex + 1}: ${
                isDone ? "выполнен" : "не выполнен"
              }`}
              onClick={() => onToggleSet(setIndex)}
              className={cn(
                "h-11 min-w-0 gap-1 px-1 text-[13px] font-normal",
                isDone &&
                  "border-success bg-success-muted text-foreground hover:bg-success-muted"
              )}
            >
              {isDone ? (
                <Check aria-hidden="true" className="size-3.5 text-success" />
              ) : (
                <Circle aria-hidden="true" className="size-3.5 text-muted-foreground" />
              )}
              Подход {setIndex + 1}
            </Button>
          ))}
        </div>

        {hiddenDone > 0 && (
          <p className="text-xs leading-snug text-muted-foreground">
            Отмечено подходов сверх выбранных: {hiddenDone}. Отметки сохранены и снова
            зачтутся, если вернуть большее число подходов.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
