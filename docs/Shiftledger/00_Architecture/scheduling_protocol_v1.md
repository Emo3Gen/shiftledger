# Scheduling Protocol v1

## State Machine

График смен проходит через следующие состояния:

1. **DRAFT** — начальное состояние, график не заполнен
2. **COLLECTING** — сбор доступности сотрудников (availability/unavailability facts)
3. **PROPOSED** — предложенный график на основе собранных фактов
4. **CONFIRMING** — подтверждение графика сотрудниками
5. **LOCKED** — график зафиксирован, изменения требуют swap requests
6. **EMERGENCY** — экстренный режим (gap обнаружен, требуется покрытие)

## Facts для графика

### SHIFT_AVAILABILITY
- **Когда**: сотрудник сообщает о доступности
- **Payload**:
  - `date`: YYYY-MM-DD
  - `dow`: день недели (mon/tue/wed/thu/fri/sat/sun)
  - `from`: время начала (HH:MM)
  - `to`: время окончания (HH:MM)
  - `availability`: "can"
- **Командный формат**: `AVAIL <dow> <from>-<to>`
  - Пример: `AVAIL mon 10-13`

### SHIFT_UNAVAILABILITY
- **Когда**: сотрудник сообщает о недоступности
- **Payload**:
  - `date`: YYYY-MM-DD
  - `dow`: день недели
  - `from`: время начала
  - `to`: время окончания
  - `availability`: "cannot"
- **Командный формат**: `CANT <dow> <from>-<to>`
  - Пример: `CANT thu 18-21`

### SHIFT_SWAP_REQUEST
- **Когда**: запрос на обмен сменой
- **Payload**:
  - `from`: { date, dow, from, to }
  - `target_user_id`: ID сотрудника для обмена
  - `status`: "requested"
- **Командный формат**: `SWAP <dow> <from>-<to> WITH <user_id>`
  - Пример: `SWAP mon 10-13 WITH isa`

### SHIFT_GAP
- **Когда**: обнаружен пробел в графике (нет покрытия)
- **Payload**:
  - `date`: YYYY-MM-DD
  - `dow`: день недели
  - `from`: время начала
  - `to`: время окончания
  - `urgency`: "high"
- **Командный формат**: `GAP <dow> <from>-<to>`
  - Пример: `GAP thu 18-21`

## Переходы состояний

- **DRAFT → COLLECTING**: начало сбора доступности
- **COLLECTING → PROPOSED**: достаточно фактов для построения графика
- **PROPOSED → CONFIRMING**: график предложен сотрудникам
- **CONFIRMING → LOCKED**: все подтвердили
- **LOCKED → EMERGENCY**: обнаружен gap после блокировки
- **EMERGENCY → COLLECTING**: требуется пересбор после экстренной ситуации

## Командный формат (DSL)

Для ускорения отладки парсер поддерживает простой командный формат в начале строки:

- `AVAIL <dow> <from>-<to>` — доступность
- `CANT <dow> <from>-<to>` — недоступность
- `SWAP <dow> <from>-<to> WITH <user_id>` — запрос обмена
- `GAP <dow> <from>-<to>` — пробел в графике

Где:
- `dow`: mon, tue, wed, thu, fri, sat, sun
- `from`, `to`: часы (1-2 цифры), автоматически дополняются до HH:00

Командный формат имеет приоритет над естественным языком (если строка начинается с команды, парсится только команда).

## Schedule Engine v0

Schedule Engine v0 — минимальный движок для построения draft schedule из фактов.

### Входные данные

- `facts`: массив persisted facts из таблицы `facts` (типы: `SHIFT_AVAILABILITY`, `SHIFT_UNAVAILABILITY`, `SHIFT_GAP`, `SHIFT_SWAP_REQUEST`)
- `weekStartISO`: дата понедельника недели в формате `YYYY-MM-DD`

### Выходные данные

```json
{
  "week_start": "2026-02-10",
  "assignments": [
    {
      "dow": "mon",
      "from": "10:00",
      "to": "13:00",
      "user_id": "u1",
      "reason": "Selected: u1 (3 availabilities this week)"
    }
  ],
  "gaps": [
    {
      "dow": "thu",
      "from": "18:00",
      "to": "21:00",
      "reason": "GAP reported, candidate found: u2 (needs confirmation)",
      "candidate_user_id": "u2"
    }
  ],
  "conflicts": [
    {
      "dow": "fri",
      "from": "18:00",
      "to": "21:00",
      "reason": "No availability for this slot",
      "candidates": []
    }
  ]
}
```

### Правила v0

1. **Сбор доступности**: берутся все факты типа `SHIFT_AVAILABILITY` с `availability="can"`
2. **Группировка**: доступность группируется по слоту `(dow, from, to)` → список `user_id`
3. **Выбор кандидата**:
   - Выбирается пользователь с максимальным количеством доступностей на неделе
   - При равенстве — первый по алфавиту
   - В `reason` указывается количество доступностей
4. **Обработка GAP**:
   - Если для слота есть факт `SHIFT_GAP`, слот считается в emergency
   - Даже если найден кандидат, слот попадает в `gaps` с пометкой "needs confirmation"
   - Если кандидата нет — попадает в `conflicts` с причиной "GAP reported but no availability found"
5. **Конфликты**: если для слота нет доступности — попадает в `conflicts` с причиной "No availability for this slot"

### Прозрачность

Каждый `assignment`, `gap` и `conflict` содержит поле `reason` для отладки логики выбора.

### API Endpoint

`GET /debug/schedule?tenant_id=...&chat_id=...&week_start=YYYY-MM-DD`

- Загружает события и факты для указанного `chat_id`
- Фильтрует только scheduling-related facts
- Вызывает `buildDraftSchedule` и возвращает результат
