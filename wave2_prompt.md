Выполни три задачи последовательно. После каждой задачи сделай git commit. Работай автономно.

Перед началом: прочитай текущее состояние проекта — server.js, factsParserV0.js, scheduleEngineV0.js, weekStateV0.js, timesheetV0.js, userDirectory.js, а также миграции в supabase/migrations/. Учти изменения, внесённые в Волне 1 (схема facts, auth middleware, Zod validation).

---

## Задача 1/3: Юнит-тесты (50+ тестов, покрытие 80%+)

1. Установи зависимости: npm install --save-dev jest

2. Добавь в package.json:
   "scripts": { "test": "jest --verbose --coverage" }

3. Создай тесты для каждого модуля:

### backend/__tests__/factsParserV0.test.js (~15 тестов)

DSL-команды:
- "AVAIL mon 10-13" → SHIFT_AVAILABILITY { dow: "mon", from: "10:00", to: "13:00", availability: "can" }
- "CANT thu 18-21" → SHIFT_UNAVAILABILITY { dow: "thu", from: "18:00", to: "21:00", availability: "cannot" }
- "SWAP mon 10-13 WITH isa" → SHIFT_SWAP_REQUEST с target_user_id: "isa"
- "GAP thu 18-21" → SHIFT_GAP
- "CONFIRM mon 10-13" → SHIFT_CONFIRM (если поддерживается)
- "ASSIGN mon 10-13 TO isa" → SHIFT_ASSIGN (если поддерживается)
- "LOCK" → WEEK_LOCK (если поддерживается)
- Невалидная команда "AVAIL xyz 99-100" → пустой массив или ошибка
- Пустая строка → пустой массив

NL-парсинг русского:
- "Пн утро могу" → SHIFT_AVAILABILITY
- "В четверг вечером не смогу" → SHIFT_UNAVAILABILITY
- "Могу в среду с 14 до 17" → SHIFT_AVAILABILITY { dow: "wed", from: "14:00", to: "17:00" }
- "Не могу в пятницу" → SHIFT_UNAVAILABILITY
- Текст без scheduling-контента "Привет, как дела?" → пустой массив

fact_hash:
- Один и тот же input → одинаковый fact_hash (детерминированность)
- Разный input → разный fact_hash

### backend/__tests__/scheduleEngineV0.test.js (~15 тестов)

- Базовый: 2 пользователя, 3 слота → корректные assignments
- Один слот без доступности → попадает в conflicts
- GAP с кандидатом → попадает в gaps с "needs confirmation"
- GAP без кандидата → попадает в conflicts с "GAP reported but no availability found"
- Равное количество доступностей → алфавитная сортировка user_id
- Пользователь с max доступностями выбирается первым
- Пустой массив facts → пустые assignments, gaps, conflicts
- SHIFT_UNAVAILABILITY исключает пользователя из слота
- Несколько пользователей на один слот → выбирается один, остальные не теряются
- week_start корректно устанавливается в выходе
- Каждый assignment/gap/conflict содержит reason

### backend/__tests__/weekStateV0.test.js (~10 тестов)

- Начальное состояние = DRAFT
- DRAFT → COLLECTING: успешный переход
- COLLECTING → PROPOSED: успешный переход
- PROPOSED → CONFIRMING: успешный переход
- CONFIRMING → LOCKED: успешный переход
- LOCKED → EMERGENCY: успешный переход
- EMERGENCY → COLLECTING: успешный переход
- Невалидный переход (например DRAFT → LOCKED) → ошибка
- Каждый переход логируется (проверь что history/log обновляется)
- Текущее состояние корректно возвращается после серии переходов

### backend/__tests__/timesheetV0.test.js (~10 тестов)

- Базовый расчёт: planned hours = worked hours → корректная зарплата
- Overtime: worked > planned → overtime отражён
- No-show: planned но не worked → no-show отражён
- Problem shift: сокращение на 1 час (текущая логика)
- Пустой input → нулевой timesheet
- Несколько сотрудников → каждый получает свою строку
- Ставка из userDirectory корректно применяется
- Итоговая сумма = сумма по сотрудникам

### backend/__tests__/validation.test.js (~5 тестов)

- Валидный ingest payload → проходит
- Пустой text → ошибка валидации
- Невалидный ts (не ISO) → ошибка
- Слишком длинный text (>5000) → ошибка
- Отсутствует обязательное поле chat_id → ошибка

4. Запусти npm test и убедись что все тесты проходят. Если какие-то падают — почини тесты или код (если в коде баг).

5. Выведи итог: сколько тестов, coverage %.

git commit -m "feat: add 50+ unit tests for parser, engine, state machine, timesheet, validation"

---

## Задача 2/3: Перенос users из кода в БД

Проблема: userDirectory.js содержит захардкоженных сотрудников. Нельзя добавить нового без деплоя.

1. Создай миграцию supabase/migrations/005_create_employees.sql:

CREATE TABLE IF NOT EXISTS public.employees (
  id text PRIMARY KEY,
  name text NOT NULL,
  role text NOT NULL DEFAULT 'staff',
  rate_per_hour numeric NOT NULL DEFAULT 0,
  min_hours_per_week numeric DEFAULT 0,
  max_hours_per_week numeric DEFAULT 40,
  is_active boolean DEFAULT true,
  meta jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Seed текущих сотрудников из userDirectory.js
-- Прочитай userDirectory.js и вставь всех реальных пользователей (не системных)
INSERT INTO public.employees (id, name, role, rate_per_hour, min_hours_per_week) VALUES
  -- ... заполни из userDirectory.js ...
ON CONFLICT (id) DO NOTHING;

2. Создай backend/employeeService.js:
   - getAll() — SELECT * FROM employees WHERE is_active = true
   - getById(id) — SELECT by id
   - create(employee) — INSERT
   - update(id, fields) — UPDATE
   - deactivate(id) — SET is_active = false
   - Если Supabase недоступен — fallback на текущий userDirectory.js (in-memory)

3. Добавь CRUD-эндпоинты в server.js (или отдельный роутер backend/routes/employees.js):
   - GET /api/employees — список активных
   - GET /api/employees/:id — один сотрудник
   - POST /api/employees — создать
   - PUT /api/employees/:id — обновить
   - DELETE /api/employees/:id — деактивировать (soft delete)
   - Все эндпоинты с auth middleware и Zod-валидацией

4. Обнови все модули, которые импортируют userDirectory.js, чтобы они использовали employeeService (с fallback на старый userDirectory если БД недоступна).

5. Проверь что сервер стартует и существующая функциональность не сломалась.

git commit -m "feat: move employees from hardcoded to DB with CRUD API"

---

## Задача 3/3: Настраиваемые временные слоты

Проблема: слоты 10:00–13:00 и 18:00–21:00 захардкожены. Для разных студий/городов нужны разные слоты.

1. Создай миграцию supabase/migrations/006_create_slot_templates.sql:

CREATE TABLE IF NOT EXISTS public.slot_templates (
  id serial PRIMARY KEY,
  tenant_id text NOT NULL DEFAULT 'dev',
  name text NOT NULL,
  dow text[] NOT NULL DEFAULT '{mon,tue,wed,thu,fri,sat,sun}',
  from_time time NOT NULL,
  to_time time NOT NULL,
  is_active boolean DEFAULT true,
  meta jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Seed дефолтных слотов (текущие захардкоженные)
INSERT INTO public.slot_templates (tenant_id, name, dow, from_time, to_time) VALUES
  ('dev', 'Утро', '{mon,tue,wed,thu,fri,sat,sun}', '10:00', '13:00'),
  ('dev', 'Вечер', '{mon,tue,wed,thu,fri,sat,sun}', '18:00', '21:00')
ON CONFLICT DO NOTHING;

2. Создай backend/slotService.js:
   - getByTenant(tenant_id) — активные слоты для tenant
   - create(slot) — новый слот
   - update(id, fields) — обновить
   - deactivate(id) — soft delete
   - Fallback: если БД недоступна, возвращать дефолтные [{ from: "10:00", to: "13:00" }, { from: "18:00", to: "21:00" }]

3. Добавь эндпоинты:
   - GET /api/slots?tenant_id=... — список слотов
   - POST /api/slots — создать
   - PUT /api/slots/:id — обновить
   - DELETE /api/slots/:id — деактивировать

4. Обнови scheduleEngineV0.js и factsParserV0.js:
   - Вместо хардкоженных слотов — загружать из slotService
   - NL-парсинг: "утро" → первый слот, "вечер" → второй слот, конкретные часы → as is
   - Если слоты не загружены — fallback на дефолтные

5. Проверь что существующие тесты проходят, добавь 3-5 тестов для slotService.

git commit -m "feat: configurable time slots per tenant (replaces hardcoded)"

---

## Финал

1. Запусти npm test — все тесты должны проходить
2. Выведи git log --oneline последние 3 коммита
3. Выведи coverage report
4. Проверь что сервер стартует без ошибок
5. Дай краткий отчёт: что сделано, что может потребовать ручной проверки
