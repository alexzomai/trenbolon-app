"use client"

import { useState } from "react"

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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { WORKOUTS, WORKOUT_IDS, isWorkoutId, type WorkoutId } from "@/lib/workout-plan"

/** Shown before a switch, because switching throws the current session away. */
export const SWITCH_WARNING =
  "При смене тренировки текущий прогресс, изменённые веса и повторения, таймер и настройки будут сброшены. Продолжить?"

interface WorkoutSelectorProps {
  /** The running built-in, or null while a saved (user) workout is running. */
  selected: WorkoutId | null
  /** Called only after the user confirms the switch. */
  onSelect: (workoutId: WorkoutId) => void
}

export function WorkoutSelector({ selected, onSelect }: WorkoutSelectorProps) {
  // Which workout is waiting for confirmation. Nothing else is held here, so
  // the selection the user sees stays the one that is actually running.
  const [pending, setPending] = useState<WorkoutId | null>(null)

  const handleValueChange = (value: string) => {
    // Radix clears the value when the pressed item was already on; treat that —
    // and anything that is not one of the three plans — as "no change".
    if (!isWorkoutId(value) || value === selected) return
    setPending(value)
  }

  return (
    <>
      <ToggleGroup
        type="single"
        value={selected ?? ""}
        onValueChange={handleValueChange}
        aria-label="Тренировка"
        // A segmented control: one gray track, the active day lifted out of it.
        className="grid w-full grid-cols-3 gap-1 rounded-xl bg-muted p-1"
      >
        {WORKOUT_IDS.map((id) => (
          <ToggleGroupItem
            key={id}
            value={id}
            // min-h over h: a label that wraps grows the button instead of
            // shrinking the 44 px tap target.
            className="min-h-10 rounded-lg border-transparent bg-transparent px-1 py-1 text-[13px] leading-tight text-muted-foreground data-[state=on]:border-transparent data-[state=on]:bg-secondary data-[state=on]:font-medium data-[state=on]:text-foreground sm:text-sm"
          >
            {WORKOUTS[id].label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          // Covers Escape, the overlay and the Cancel button: nothing changes.
          if (!open) setPending(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending === null
                ? "Сменить тренировку?"
                : `Сменить тренировку на ${WORKOUTS[pending].label}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>{SWITCH_WARNING}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending !== null) onSelect(pending)
              }}
            >
              Продолжить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
