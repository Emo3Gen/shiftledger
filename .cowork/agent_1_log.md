# Лог Агента 1 — 2026-04-03

## Задача: SL-001 — Исправление бага противоречий в движке расписания

### Диагностика

Прочитан `backend/scheduleEngineV0.js`. Баг подтверждён в Phase 2.5 (ребаланс минимальных часов, строки ~468–498).

**Суть бага:** Переменная `unavailableBySlot` (Map: slotKey → Set<userId>) заполняется на шаге 1.5 при обработке `SHIFT_UNAVAILABILITY`-фактов. Однако в цикле Phase 2.5 перед назначением проверялось только `slot.candidates.includes(empId)` — наличие пользователя в списке кандидатов из `SHIFT_AVAILABILITY`. Если пользователь сначала добавил себя в доступные, а потом отметил недоступность — он мог попасть в кандидаты, но `unavailableBySlot` при ребалансе не проверялось.

### Исправление

Файл: `/Users/evgenij/shiftledger/backend/scheduleEngineV0.js`, Phase 2.5.

Добавлена проверка сразу после `!slot.candidates.includes(empId)`:

```javascript
// Do not assign to a slot where this employee marked themselves unavailable
const unavailForSlot = unavailableBySlot.get(slot.slotKey);
if (unavailForSlot && unavailForSlot.has(empId)) continue;
```

Аналогичная проверка уже существовала в Phase 3 (senior reserve) — новая проверка приводит Phase 2.5 к тому же уровню защиты.

### Тест

Файл: `/Users/evgenij/shiftledger/backend/__tests__/scheduleEngineV0.test.js`

Добавлен тест `rebalance does not assign unavailable user to slot`:
- u1 и u4 оба доступны на пн утро и вт утро
- u4 дополнительно отмечает недоступность на вт утро
- После сборки расписания u4 НЕ должен быть назначен на вт утро, даже если у него недобор часов до minHours=20

### Результаты прогона тестов

```
Test Suites: 14 passed, 14 total
Tests:       481 passed, 481 total
Snapshots:   0 total
Time:        8.306 s
```

Все 481 тест прошли успешно, включая новый.

### Статус

- [x] Баг найден и проанализирован
- [x] Исправление применено в scheduleEngineV0.js
- [x] Новый тест написан и проходит
- [x] Все существующие тесты проходят (0 failures)
- [x] Лог обновлён
- [x] QA-отчёт обновлён

---

# Архив: Лог Агента 1 — 2026-04-02

## Задача дня
SL-002: рефакторинг обработки SHIFT_REPLACEMENT — устранение бага «Ксюша за Ксюша» при пересчёте.

## Что сделано
- Изучил логику Step 3.5 в `scheduleEngineV0.js` (строки 542–590)
- Нашёл корень проблемы: при повторном `buildDraftSchedule` после сохранения SHIFT_ASSIGNMENT, движок пытался применить SHIFT_REPLACEMENT поверх уже применённого назначения. Результат — `replaced_user_id === user_id`.
- Добавил проверку: если `original.user_id === repl.replacement_user_id`, замена пропускается (continue).
- Написал тест `SHIFT_REPLACEMENT skips swap when SHIFT_ASSIGNMENT already assigns replacement user`.

## Результат
- Тест проходит. Баг «X за X» больше не воспроизводится.
- Все 20 существующих тестов проходят (`npm test` — 20 passed).

## Блокеры
- Обнаружен потенциальный баг: в Phase 2.5 (ребаланс минимальных часов) нет проверки `unavailableBySlot`. Оформлен как SL-001 — исправлён 2026-04-03.
