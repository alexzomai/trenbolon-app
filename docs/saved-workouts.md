# Локальный каталог тренировок

Модуль `lib/saved-workouts.ts` хранит пользовательские определения отдельно от текущей сессии (`lib/workout-storage.ts`). Выбран localStorage: каталог содержит небольшой объём JSON, без медиа и серверных зависимостей.

## Интерфейс для редактора

```ts
import { savedWorkouts, draftFromWorkout } from "@/lib/saved-workouts"
import { getWorkout } from "@/lib/workout-plan"

const loaded = savedWorkouts.list()
if (!loaded.ok) {
  // Показать ошибку; не объявлять, что список действительно пуст.
} else {
  // loaded.value: SavedWorkout[]
}

const draft = draftFromWorkout(getWorkout("pull"))
const created = savedWorkouts.create(draft)
if (created.ok) {
  const id = created.value.id
  const restored = savedWorkouts.get(id)
  const updated = savedWorkouts.update(id, { ...draft, title: "Моя спина" })
  const removed = savedWorkouts.remove(id)
  // Каждый результат проверяется отдельно. Только ok:true означает успех.
}
```

Все методы синхронные и возвращают `StorageResult<T>`:

- `list(): StorageResult<SavedWorkout[]>`
- `get(id: string): StorageResult<SavedWorkout>`
- `create(draft: WorkoutDraft): StorageResult<SavedWorkout>`
- `update(id: string, draft: WorkoutDraft): StorageResult<SavedWorkout>` (полная замена определения, ID сохраняется)
- `remove(id: string): StorageResult<null>`

`WorkoutDraft`: `label`, `title`, упорядоченный массив `exercises`, `restSeconds`, `soundEnabled`. Каждый Exercise сохраняет `id`, `name`, `sets`, необязательный `setOptions`, `reps`, `weight`. Строки веса и повторений свободные, включая диапазоны и «до отказа»; вес может быть пустым. Названия, label, title и reps обязательны; sets и setOptions: целые 1..100, варианты уникальны и включают sets; restSeconds: поддерживаемые приложением 60/90/120/180. ID упражнений уникальны внутри определения. Порядок массива определяет порядок выполнения. При добавлении упражнения редактор генерирует его стабильный ID, при перестановке сохраняет его.

Новые ID тренировок имеют вид `user:<UUID>`; update/remove не могут изменить встроенные `pull`/`push`/`legs`. `draftFromWorkout` создаёт независимую глубокую копию упражнений и вариантов подходов. Для новой пустой формы редактор создаёт WorkoutDraft сам; пустой массив упражнений не сохраняется.

## Подключение запуска

`SavedWorkout` не является старым `Workout`: у старого тип ID ограничен тремя шаблонами. При подключении редактора нужно расширить разрешение определения в модели сессии (сейчас `workoutOf` вызывает только `getWorkout`) и восстановление сессии. Не передавать пользовательский ID через приведение `as WorkoutId`: существующий reducer/парсер отвергнет его. Сохранять выбранное определение/снимок и реально использовать его exercises, restSeconds, soundEnabled при старте. Этот модуль намеренно не меняет reducer и UI, которые дорабатываются отдельной задачей.

Прогресс, completed, абсолютный deadline и beepAt не входят в определение. Для сохранения текущих пользовательских значений из сессии редактор должен скопировать в упражнения `weights`, `reps`, выбранное число подходов, затем передать restSeconds/soundEnabled. Библиотека не читает состояние текущей сессии неявно.

## Формат и ошибки

Ключ `ui-workout:workouts`: `{ "version": 1, "workouts": [...] }`. Ключ `ui-workout:state` не затрагивается. Импорт безопасен при SSR, доступ к браузеру осуществляется только в методах. Отсутствие ключа означает пустой список. Каждый метод читает актуальное хранилище, не кеширует успешные записи в памяти.

Ошибки: `unavailable` (нет доступа/SSR), `quota` (квота), `write-failed`, `corrupt`, `unsupported-version`, `invalid` (невалидный draft/коллизия ID), `not-found`. При ошибке записи возвращается ok:false, старые данные остаются; редактор сохраняет draft и не показывает уведомление об успехе. При corrupt/unsupported-version методы не перезаписывают исходный ключ, даже при попытке create/delete; показать понятное сообщение о проблеме сохранённых данных. Автоматический сброс/миграция отсутствуют, чтобы не уничтожить данные другой версии. Все записи каталога валидируются целиком.

localStorage привязан к браузеру и origin, очищается при удалении данных сайта, не является резервной копией и не синхронизируется между устройствами. При одновременной записи из разных вкладок действует ограничение localStorage: read-modify-write не транзакционен, последняя запись побеждает. Для текущего однопользовательского сценария это осознанное ограничение.

Для тестов доступна фабрика `createWorkoutRepository(storageProvider?, newId?)`.
