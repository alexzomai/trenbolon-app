"use client"

import { Check, Circle } from "lucide-react"
import { useId } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
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
  const finished = sets > 0 && done === sets

  // The planned set range, when there is one, lives in the ⓘ panel instead.
  const options = exercise.setOptions

  return (
    <Card
      size="sm"
      className={cn(
        "gap-2.5 rounded-xl bg-card ring-1 ring-border [--card-spacing:--spacing(3)]",
        // Completed cards recede rather than shout: a green hairline, no fill.
        finished && "ring-success/40"
      )}
    >
      <CardHeader className="gap-x-2.5">
        {/* The position is a badge rather than a prefix in the title: the cards
            are an ordered list, so screen readers already announce the number. */}
        <CardTitle className="flex min-w-0 items-start gap-2.5 text-[0.95rem] leading-snug font-semibold">
          <span
            aria-hidden="true"
            data-slot="exercise-number"
            className={cn(
              "mt-px grid size-6 shrink-0 place-items-center rounded-md bg-secondary text-xs font-semibold tabular-nums",
              finished ? "text-success" : "text-muted-foreground"
            )}
          >
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 break-words">{exercise.name}</span>
        </CardTitle>

        {/* Prescription and progress sit beside the title instead of on their own
            line below it, which keeps the card shorter. */}
        <CardAction className="mt-px flex items-center gap-x-1.5 text-xs font-normal whitespace-nowrap text-muted-foreground tabular-nums">
          <span>
            {sets} × {reps.trim() || "—"}
          </span>
          <span aria-hidden="true">·</span>
          <span className={cn(finished && "text-success")}>
            <span className="sr-only">выполнено подходов: </span>
            {done}/{sets}
          </span>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {/* Weight and reps are hidden for now; the fields stay mounted so their
            state and programmatic value handling keep working unchanged. With
            both of them hidden the row only carries the set-count toggle, so it
            collapses entirely when an exercise has no set options. */}
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2" hidden={!options}>
          <div className="flex min-w-0 flex-1 basis-24 flex-col gap-1" hidden>
            <Label htmlFor={weightId} className="text-xs font-normal text-muted-foreground">
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
              className="h-10 w-full min-w-0 border-transparent bg-secondary text-sm"
            />
          </div>
          <div className="flex min-w-0 flex-1 basis-24 flex-col gap-1" hidden>
            <Label htmlFor={repsId} className="text-xs font-normal text-muted-foreground">
              Повторения
            </Label>
            <Input
              id={repsId}
              value={reps}
              onChange={(event) => onRepsChange(event.target.value)}
              placeholder="—"
              inputMode="text"
              autoComplete="off"
              aria-label={`Количество повторений, ${exercise.name}`}
              className="h-10 w-full min-w-0 border-transparent bg-secondary text-sm"
            />
          </div>
          {options && (
            <div className="flex shrink-0 flex-col gap-1">
              <span id={setsLabelId} className="text-xs text-muted-foreground">
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
                    className="size-10 px-0 text-sm tabular-nums"
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
      </CardContent>
    </Card>
  )
}
