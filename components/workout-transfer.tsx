"use client"

import { useId, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { savedWorkouts, type SavedWorkout } from "@/lib/saved-workouts"
import { storageErrorMessage } from "@/lib/workout-editor"
import {
  AI_PROMPT,
  MAX_IMPORT_CHARS,
  SAMPLE_FILE_NAME,
  SAMPLE_JSON,
  SCHEMA_FILE_NAME,
  buildExportJson,
  parseWorkoutImport,
  type ParseResult,
} from "@/lib/workout-transfer"

/** Bytes, not characters: a Cyrillic character takes 2–3 bytes in UTF-8. */
const MAX_FILE_BYTES = MAX_IMPORT_CHARS * 4

const AREA_CLASS =
  "min-h-32 w-full rounded-lg border border-input bg-transparent p-2.5 font-mono text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm"

interface WorkoutTransferProps {
  /** Null when the catalog could not be read: export is then unavailable. */
  catalog: SavedWorkout[] | null
  onBack: () => void
  /** Called after a successful, fully written import. */
  onImported: (count: number) => void
}

interface Note {
  kind: "ok" | "error"
  text: string
}

function downloadText(fileName: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }))
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

async function copyText(content: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false
    await navigator.clipboard.writeText(content)
    return true
  } catch {
    return false
  }
}

function ReadonlyText({ label, value, rows = 8 }: { label: string; value: string; rows?: number }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        readOnly
        rows={rows}
        value={value}
        className={AREA_CLASS}
        onFocus={(event) => event.currentTarget.select()}
      />
    </div>
  )
}

export function WorkoutTransfer({ catalog, onBack, onImported }: WorkoutTransferProps) {
  const inputId = useId()
  const fileId = useId()
  const [text, setText] = useState("")
  const [checked, setChecked] = useState<{ text: string; result: ParseResult } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [note, setNote] = useState<Note | null>(null)

  const exportJson = useMemo(() => (catalog && catalog.length ? buildExportJson(catalog) : ""), [catalog])

  // A preview is only valid for the exact text it was built from.
  const preview = checked && checked.text === text ? checked.result : null

  const check = (value: string) => {
    setImportError(null)
    setNote(null)
    setChecked({ text: value, result: parseWorkoutImport(value) })
  }

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setImportError(null)
    setNote(null)
    if (file.size > MAX_FILE_BYTES) {
      setChecked(null)
      setNote({ kind: "error", text: `Файл слишком большой (${Math.ceil(file.size / 1024)} КБ). Выберите файл поменьше.` })
      return
    }
    try {
      const content = await file.text()
      setText(content)
      check(content)
    } catch {
      setChecked(null)
      setNote({ kind: "error", text: "Не удалось прочитать файл." })
    }
  }

  const handleImport = () => {
    if (!preview?.ok) return
    const result = savedWorkouts.importDrafts(preview.drafts)
    if (!result.ok) {
      setImportError(`Ничего не добавлено: ${storageErrorMessage(result)}`)
      return
    }
    onImported(result.value.length)
  }

  const copy = async (content: string, what: string) => {
    const ok = await copyText(content)
    setNote(
      ok
        ? { kind: "ok", text: `${what} скопировано.` }
        : { kind: "error", text: "Не удалось скопировать автоматически. Выделите текст в поле и скопируйте вручную." }
    )
  }

  const exportDisabled = exportJson === ""

  return (
    <div className="flex flex-col gap-5">
      {note && (
        <p role={note.kind === "error" ? "alert" : "status"} className={note.kind === "error" ? "text-sm text-destructive" : "text-sm text-success"}>
          {note.text}
        </p>
      )}

      <section aria-label="Импорт" className="flex flex-col gap-3">
        <h3 className="font-semibold">Импорт</h3>
        <p className="text-sm text-muted-foreground">
          Импорт только добавляет новые тренировки: существующие и идущая сейчас тренировка не меняются.
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={fileId}>Файл JSON</Label>
          <input
            id={fileId}
            type="file"
            accept=".json,application/json"
            className="min-h-11 w-full text-sm file:mr-3 file:h-9 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:text-secondary-foreground"
            onChange={(event) => {
              void handleFile(event.target.files?.[0])
              event.target.value = ""
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={inputId}>Или вставьте JSON</Label>
          <textarea
            id={inputId}
            rows={6}
            value={text}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder='{"version":1,"workouts":[…]}'
            aria-invalid={preview && !preview.ok ? true : undefined}
            className={AREA_CLASS}
            onChange={(event) => {
              setText(event.target.value)
              setImportError(null)
            }}
          />
        </div>
        <Button type="button" variant="secondary" className="h-11 px-3 font-normal" disabled={!text.trim()} onClick={() => check(text)}>
          Проверить
        </Button>

        {preview && !preview.ok && (
          <div role="alert" className="flex flex-col gap-1 text-sm text-destructive">
            <p className="font-semibold">Импорт невозможен: ничего не будет добавлено.</p>
            <ul className="list-disc pl-5">
              {preview.errors.map((error, index) => (
                <li key={index} className="break-words">{error}</li>
              ))}
            </ul>
            {preview.truncated && <p>Показаны не все ошибки. Исправьте эти и проверьте снова.</p>}
          </div>
        )}

        {preview?.ok && (
          <div className="flex flex-col gap-2">
            <p role="status" className="text-sm text-success">
              Проверка пройдена. Будет добавлено тренировок: {preview.drafts.length}.
            </p>
            <ul aria-label="Предпросмотр импорта" className="flex list-none flex-col gap-2 p-0">
              {preview.drafts.map((draft, index) => (
                <li key={index} className="rounded-xl border border-border p-3 text-sm">
                  <p className="font-semibold break-words">{draft.title}</p>
                  <p className="text-muted-foreground break-words">
                    {draft.label} · упражнений: {draft.exercises.length} · отдых {draft.restSeconds} с ·
                    звук {draft.soundEnabled ? "вкл" : "выкл"}
                  </p>
                </li>
              ))}
            </ul>
            <Button type="button" className="h-11 px-3" onClick={handleImport}>
              Импортировать
            </Button>
          </div>
        )}
        {importError && (
          <p role="alert" className="text-sm text-destructive">{importError}</p>
        )}
      </section>

      <section aria-label="Экспорт" className="flex flex-col gap-3">
        <h3 className="font-semibold">Экспорт</h3>
        {exportDisabled ? (
          <p className="text-sm text-muted-foreground">
            {catalog === null ? "Сохранённые тренировки не загружены, экспорт недоступен." : "Нет сохранённых тренировок для экспорта."}
          </p>
        ) : (
          <>
            <ReadonlyText label="JSON сохранённых тренировок" value={exportJson} />
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                className="h-11 px-2"
                onClick={() => {
                  try {
                    downloadText("trenbolon-workouts.json", exportJson)
                  } catch {
                    setNote({ kind: "error", text: "Не удалось скачать файл. Скопируйте текст из поля." })
                  }
                }}
              >
                Скачать JSON
              </Button>
              <Button type="button" variant="secondary" className="h-11 px-2 font-normal" onClick={() => void copy(exportJson, "JSON")}>
                Копировать JSON
              </Button>
            </div>
          </>
        )}
      </section>

      <section aria-label="Подсказка для ИИ" className="flex flex-col gap-3">
        <h3 className="font-semibold">Составить тренировку с помощью ИИ</h3>
        <p className="text-sm text-muted-foreground">
          Скопируйте инструкцию, дополните её своим пожеланием, отправьте любому ИИ-агенту и вставьте его ответ выше.
        </p>
        <ReadonlyText label="Инструкция для ИИ" value={AI_PROMPT} rows={8} />
        <Button type="button" variant="secondary" className="h-11 px-3 font-normal" onClick={() => void copy(AI_PROMPT, "Инструкция")}>
          Копировать инструкцию для ИИ
        </Button>
        <ReadonlyText label="Пример JSON" value={SAMPLE_JSON} rows={8} />
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="secondary" className="h-11 px-2 font-normal" onClick={() => void copy(SAMPLE_JSON, "Пример")}>
            Копировать пример
          </Button>
          <Button type="button" variant="secondary" className="h-11 px-2 font-normal" onClick={() => setText(SAMPLE_JSON)}>
            Вставить пример
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Файлы для агентов: <a className="underline" href={`/${SAMPLE_FILE_NAME}`} download>пример</a>,{" "}
          <a className="underline" href={`/${SCHEMA_FILE_NAME}`} download>JSON Schema</a>.
        </p>
      </section>

      <Button type="button" variant="secondary" className="h-11 px-3 font-normal" onClick={onBack}>
        Назад к списку
      </Button>
    </div>
  )
}
