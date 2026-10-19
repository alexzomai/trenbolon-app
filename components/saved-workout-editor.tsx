"use client"

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"
import { useId } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  MAX_EXERCISES,
  REST_SECONDS_MESSAGE,
  blankExercise,
  type ExerciseForm,
  type FormErrors,
  type WorkoutForm,
} from "@/lib/workout-editor"

interface SavedWorkoutEditorProps {
  form: WorkoutForm
  onChange: (form: WorkoutForm) => void
  /** Present only after a failed validation or save; cleared by the parent. */
  errors: FormErrors | null
  /** Failure of the last save attempt. The draft is kept untouched. */
  saveError: string | null
}

interface FieldProps {
  label: string
  value: string
  error?: string
  onChange: (value: string) => void
  hint?: string
  inputMode?: "numeric"
}

function Field({ label, value, error, onChange, hint, inputMode }: FieldProps) {
  const id = useId()
  const messageId = `${id}-message`
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        inputMode={inputMode}
        className="h-11"
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? messageId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {(error || hint) && (
        <p id={messageId} className={error ? "text-sm text-destructive" : "text-xs text-muted-foreground"}>
          {error ?? hint}
        </p>
      )}
    </div>
  )
}

/** Controlled editor body; the parent owns the draft so it can guard leaving. */
export function SavedWorkoutEditor({ form, onChange, errors, saveError }: SavedWorkoutEditorProps) {
  const soundId = useId()

  const patchExercise = (id: string, patch: Partial<ExerciseForm>) =>
    onChange({
      ...form,
      exercises: form.exercises.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    })

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= form.exercises.length) return
    const exercises = form.exercises.slice()
    ;[exercises[index], exercises[target]] = [exercises[target], exercises[index]]
    onChange({ ...form, exercises })
  }

  return (
    <form
      id="saved-workout-form"
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => event.preventDefault()}
    >
      <Field
        label="Короткое название"
        value={form.label}
        error={errors?.label}
        onChange={(label) => onChange({ ...form, label })}
      />
      <Field
        label="Заголовок тренировки"
        value={form.title}
        error={errors?.title}
        onChange={(title) => onChange({ ...form, title })}
      />

      <Field
        label="Отдых между подходами, с"
        value={form.restSeconds}
        inputMode="numeric"
        error={errors?.restSeconds}
        hint={REST_SECONDS_MESSAGE}
        onChange={(restSeconds) => onChange({ ...form, restSeconds })}
      />

      <div className="flex min-h-11 items-center gap-2">
        <Checkbox
          id={soundId}
          checked={form.soundEnabled}
          onCheckedChange={(checked) => onChange({ ...form, soundEnabled: checked === true })}
        />
        <Label htmlFor={soundId} className="font-normal">
          Звуковой сигнал в конце отдыха
        </Label>
      </div>

      <section aria-label="Упражнения" className="flex flex-col gap-3">
        <h3 className="font-semibold">Упражнения</h3>
        {errors?.exercises && <p className="text-sm text-destructive">{errors.exercises}</p>}
        <ol className="flex list-none flex-col gap-3 p-0">
          {form.exercises.map((item, index) => {
            const itemErrors = errors?.items[item.id]
            const number = index + 1
            return (
              <li key={item.id}>
                <fieldset className="flex min-w-0 flex-col gap-3 rounded-xl border border-border p-3">
                  <legend className="px-1 text-sm font-semibold">Упражнение {number}</legend>
                  <Field
                    label={`Название упражнения ${number}`}
                    value={item.name}
                    error={itemErrors?.name}
                    onChange={(name) => patchExercise(item.id, { name })}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      label={`Подходы ${number}`}
                      value={item.sets}
                      inputMode="numeric"
                      error={itemErrors?.sets}
                      onChange={(sets) => patchExercise(item.id, { sets })}
                    />
                    <Field
                      label={`Повторения ${number}`}
                      value={item.reps}
                      error={itemErrors?.reps}
                      onChange={(reps) => patchExercise(item.id, { reps })}
                    />
                  </div>
                  <Field
                    label={`Вес ${number}`}
                    value={item.weight}
                    onChange={(weight) => patchExercise(item.id, { weight })}
                  />
                  <Field
                    label={`Варианты подходов ${number} (необязательно)`}
                    value={item.setOptions}
                    error={itemErrors?.setOptions}
                    hint="Например: 2, 3, 4"
                    onChange={(setOptions) => patchExercise(item.id, { setOptions })}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      className="size-11 p-0"
                      aria-label={`Переместить упражнение ${number} выше`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp aria-hidden="true" className="size-5" />
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="size-11 p-0"
                      aria-label={`Переместить упражнение ${number} ниже`}
                      disabled={index === form.exercises.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown aria-hidden="true" className="size-5" />
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      className="h-11 grow px-3"
                      aria-label={`Удалить упражнение ${number}`}
                      onClick={() =>
                        onChange({
                          ...form,
                          exercises: form.exercises.filter((entry) => entry.id !== item.id),
                        })
                      }
                    >
                      <Trash2 aria-hidden="true" className="size-4" />
                      Удалить
                    </Button>
                  </div>
                </fieldset>
              </li>
            )
          })}
        </ol>
        <Button
          type="button"
          variant="secondary"
          className="h-11 px-3"
          disabled={form.exercises.length >= MAX_EXERCISES}
          onClick={() => onChange({ ...form, exercises: [...form.exercises, blankExercise()] })}
        >
          <Plus aria-hidden="true" className="size-4" />
          Добавить упражнение
        </Button>
      </section>

      {errors && (
        <p role="alert" className="text-sm text-destructive">
          Исправьте отмеченные поля.
        </p>
      )}
      {saveError && (
        <p role="alert" className="text-sm text-destructive">
          Не удалось сохранить: {saveError} Черновик не потерян — можно повторить.
        </p>
      )}
    </form>
  )
}
