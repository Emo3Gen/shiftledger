# Задание для Агента 3 — 2026-04-03

## Задача: SL-005 — Стресс-тесты движка расписания
**Приоритет:** 🟡 средний

## Суть
Текущие тесты проверяют типичные сценарии. Нужно написать тесты для экстремальных и граничных ситуаций, чтобы убедиться, что движок ведёт себя предсказуемо и не падает.

## Контекст
Файл тестов: `backend/__tests__/scheduleEngineV0.test.js`
Движок: `backend/scheduleEngineV0.js`, экспортирует `buildDraftSchedule({ facts, weekStartISO })`

Структура факта (helper `makeFact` уже есть в тестах):
```javascript
{
  fact_type: "SHIFT_AVAILABILITY",  // или SHIFT_UNAVAILABILITY, SHIFT_GAP, и т.д.
  user_id: "u1",
  fact_payload: { dow: "mon", from: "10:00", to: "13:00", availability: "can" },
  created_at: "2025-01-05T10:00:00Z"
}
```

## Сценарии для тестирования

### Сценарий А: Все сотрудники недоступны
- Все 4 сотрудника (u1–u4) отправляют SHIFT_UNAVAILABILITY на все 14 слотов недели.
- Ни одного факта SHIFT_AVAILABILITY.
- **Ожидание:** `assignments` пуст. `gaps` или `conflicts` содержат все слоты. Движок НЕ падает.
- **Название теста:** `all employees unavailable → no assignments, no crash`

### Сценарий Б: Противоречивые запросы одного сотрудника
- u1 отправляет SHIFT_AVAILABILITY на пн утро.
- u1 затем отправляет SHIFT_UNAVAILABILITY на пн утро (с более поздним `created_at`).
- **Ожидание:** u1 НЕ назначен на пн утро. Недоступность имеет приоритет.
- **Название теста:** `availability then unavailability for same slot → user not assigned`

### Сценарий В: Граничные случаи по времени
Три подтеста:
1. **Слот длиной 0 часов** (`from: "10:00", to: "10:00"`): движок не падает, часы = 0.
2. **Слот через полночь** (`from: "22:00", to: "02:00"`): движок возвращает 0 или отрицательное значение (текущая реализация `calculateSlotHours` вернёт отрицательное — задокументировать как known limitation).
3. **Некорректный формат времени** (`from: "abc", to: "xyz"`): движок не падает (NaN-safe).
- **Название:** `edge case: zero-length slot`, `edge case: overnight slot`, `edge case: invalid time format`

### Сценарий Г: Большой объём данных
- Сгенерировать 100 фактов SHIFT_AVAILABILITY от 10 виртуальных сотрудников на все слоты.
- **Ожидание:** движок возвращает результат за < 100 мс. Все слоты имеют назначение.
- **Название теста:** `100 facts from 10 users → completes within 100ms`

### Сценарий Д: Дублирующие факты
- Один и тот же факт (u1 доступен на пн утро) отправлен 5 раз.
- **Ожидание:** u1 назначен ровно 1 раз на пн утро. Дубликаты не создают лишних назначений.
- **Название теста:** `duplicate availability facts → single assignment`

## Структура тестов
Создай новый `describe` блок внутри существующего файла:
```javascript
describe("stress tests", () => {
  test("all employees unavailable → ...", () => { ... });
  test("availability then unavailability → ...", () => { ... });
  // и т.д.
});
```

## Критерии готовности
- [ ] Минимум 6 новых тестов (по сценариям А–Д)
- [ ] Все новые тесты проходят
- [ ] Все существующие тесты по-прежнему проходят (0 failures)
- [ ] В логе описано что было сделано и какие проблемы обнаружены

## Файлы для изучения
- `backend/__tests__/scheduleEngineV0.test.js` — существующие тесты (смотри `makeFact` helper)
- `backend/scheduleEngineV0.js` — движок
- `backend/userDirectory.js` — справочник сотрудников
