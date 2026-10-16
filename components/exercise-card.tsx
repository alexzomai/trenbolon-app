"use client"

import { Check, Circle } from "lucide-react"
import { useId } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import type { Exercise } from "@/lib/workout-plan"

interface ExerciseCardProps {
  exercise: Exercise
  index: number
  marks: boolean[]
  weight: string
  reps: string
  onToggleSet: (setIndex: number) => void
  onWeightChange: (value: string) => void
  onRepsChange: (value: string) => void
}

export function ExerciseCard({
  exercise,
  index,
  marks,
  weight,
  reps,
  onToggleSet,
  onWeightChange,
  onRepsChange,
}: ExerciseCardProps) {
  const fieldId = useId()
  const weightId = `${fieldId}-weight`
  const repsId = `${fieldId}-reps`
  const done = marks.filter(Boolean).length
  const title = `${index + 1}. ${exercise.name}`

  return (
    <Card
      size="sm"
      className="gap-3 rounded-xl bg-card ring-1 ring-border [--card-spacing:--spacing(3.5)]"
    >
      <CardHeader className="items-center gap-x-3">
        <CardTitle className="text-[0.95rem] leading-snug font-semibold">{title}</CardTitle>
        <CardAction className="self-center text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          <span>
            {exercise.sets} × {reps.trim() || "—"}
          </span>
          <span aria-hidden="true"> · </span>
          <span>
            <span className="sr-only">выполнено подходов: </span>
            {done}/{exercise.sets}
          </span>
        </CardAction>
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
        </div>

        <div className="grid grid-cols-3 gap-2">
          {marks.map((isDone, setIndex) => (
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
