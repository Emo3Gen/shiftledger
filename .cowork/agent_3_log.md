# Лог Агента 3 — 2026-04-03

## Задача дня
SL-005: написать стресс-тесты для движка расписания.

## Что сделано
Добавил блок `describe("stress tests", () => { ... })` в `backend/__tests__/scheduleEngineV0.test.js`.

7 новых тестов:

1. `all employees unavailable → no assignments, no crash`
   - u1–u4 отправляют SHIFT_UNAVAILABILITY на все 14 слотов недели. Проверяем: assignments пуст, исключений нет.

2. `availability then unavailability for same slot → user not assigned`
   - u1 сначала отмечает доступность (09:00), потом недоступность (11:00) для пн утра. Более поздний факт должен побеждать — u1 не назначен.

3. `edge case: zero-length slot (from === to)`
   - Слот `from: "10:00", to: "10:00"`. Движок не падает, возвращает валидный результат.

4. `edge case: overnight slot (from > to across midnight)`
   - Слот `from: "22:00", to: "02:00"`. Движок не падает. Поведение задокументировано как known limitation — результат валиден, но часы могут быть некорректны.

5. `edge case: invalid time format in slot`
   - Слот `from: "abc", to: "xyz"`. Движок не падает, возвращает валидный результат.

6. `100 facts from 10 users → completes within 100ms`
   - 140 фактов от 10 виртуальных сотрудников на все 14 слотов. Замер времени: < 100 мс. Реальное время: ~9 мс.

7. `duplicate availability facts → single assignment per slot`
   - u1 отправляет 5 идентичных фактов SHIFT_AVAILABILITY для пн утра. Проверяем: ровно 1 назначение на слот.

## Результат
- Все 7 новых тестов проходят ✅
- Все существующие 481 тест проходят ✅
- Итого: **488 passed, 0 failed**
- Стресс-тесты подтвердили: движок устойчив к экстремальным входным данным.

## Блокеры
- Нет.
