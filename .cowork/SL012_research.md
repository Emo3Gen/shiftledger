# SL-012 — Исследование режимов источников данных

**Дата:** 2026-04-03
**Статус:** Исследование завершено, действий не предпринято

---

## 1. Как `/debug/dialogs` фильтрует по tenant_id

**Файл:** `backend/server.js:1092-1128`

Эндпоинт `/debug/dialogs?tenant_id=X` работает так:

1. Загружает последние 500 событий из Supabase `events` (БЕЗ фильтра по tenant на уровне БД)
2. Фильтрует в памяти: `(row.meta?.tenant_id || row.source) === tenant_id`
3. Группирует по `chat_id`, берёт до 50 уникальных диалогов

**Логика**: если у события есть `meta.tenant_id` — используется оно; иначе fallback на поле `source`.

### Как записываются события разными источниками

| Источник | `source` | `meta.tenant_id` | Виден в tenant= |
|----------|----------|-------------------|-----------------|
| Симулятор (`/debug/send`) | `"emu"` (default) | не передаётся (undefined) | **emu** (через source) |
| Telegram бот (`buildIngestPayload`) | `"emu"` (default!) | `"dev"` (из `DEFAULT_TENANT_ID`) | **emu** (через source) И **dev** (через meta) |
| DirectorPanel (`/debug/send` + seed) | `"emu"` (default) | не передаётся | **emu** (через source) |

### BUG: Нарушена изоляция tenant'ов

**Telegram-события видны в обоих tenant'ах** (`emu` и `dev`), потому что:
- `source` по умолчанию `"emu"` для всех источников (server.js:250: `source: source ?? "emu"`)
- `buildIngestPayload` в bot.js:58 НЕ задаёт `source`, поэтому Telegram-события получают `source: "emu"`
- Фильтр `/debug/dialogs?tenant_id=emu` находит их по `source === "emu"`
- Фильтр `/debug/dialogs?tenant_id=dev` находит их по `meta.tenant_id === "dev"`

**Корень проблемы**: `buildIngestPayload` не устанавливает `source: "telegram"` или `source: "dev"`.

---

## 2. Может ли панель видеть TG-чат `-1002789466545`

### App.tsx (основной симулятор)

**Файл:** `apps/simulator/src/App.tsx:655-698`

- **Да, может**. Имеет селектор tenant'а (загружает из `/debug/tenants`)
- По умолчанию выбирает tenant `"emu"` (строка 665)
- При загрузке диалогов предпочитает TG-чаты (строка 687): `d.chat_id.startsWith("-") || d.chat_id.startsWith("tg_")`
- Можно переключиться на tenant `"dev"` и увидеть TG-диалоги
- **Но из-за бага tenant-изоляции**: TG-чат виден и при tenant=emu

### DirectorPanel.tsx

**Файл:** `apps/simulator/src/DirectorPanel.tsx:1185-1233`

- **Нет переключателя tenant'а** — захардкожен `"emu"` (строка 1193: `/debug/dialogs?tenant_id=emu`)
- Настройки жёстко привязаны к `"dev"` (строка 1167: `/api/settings?tenant_id=dev`, строка 1269: `putJSON("/api/settings/${key}", { value, tenant_id: "dev" })`)
- **Из-за бага**: TG-диалоги всё равно просачиваются, т.к. TG-события имеют `source: "emu"`

### Вывод
DirectorPanel видит TG-чат как побочный эффект бага. App.tsx видит его и через tenant-селектор, и через баг.

---

## 3. Предполагаемая архитектура (из документации)

### ingest_contract.md
- `tenant_id` — идентификатор организации (арендатора)
- `channel` — источник: `telegram`, `mobile`, `web`, `emu`
- `chat_id` — логический идентификатор диалога внутри tenant
- Разделение: tenant = "кто", channel = "откуда"

### chat_simulator_spec.md
- Симулятор работает через `POST /debug/send` с `channel: "emu"`
- Предполагается фильтрация диалогов по `tenant_id`

### COWORK_CONTEXT.md
- Telegram-бот и симулятор — два независимых канала доставки
- Тестовые данные (seed) используют `chat_id: "dev_seed_chat"`

### Фактическое состояние vs. задуманное

| Аспект | Задумано (ingest_contract) | Реализовано |
|--------|---------------------------|-------------|
| Поле `channel` | Обязательное, для фильтрации | Сохраняется в meta, НЕ используется для фильтрации |
| Поле `tenant_id` | Обязательное, top-level | Опциональное, хранится в `meta.tenant_id` |
| Поле `source` | Не описано | Используется как fallback для tenant_id |
| Изоляция каналов | По `channel` (emu / telegram) | Отсутствует — всё через source="emu" |

---

## 4. Заключение и рекомендации

### Обнаруженные проблемы

1. **Нарушена изоляция tenant'ов** — TG-события видны при запросе `tenant_id=emu` из-за общего `source: "emu"`
2. **`channel` не используется** — хотя описан в ingest_contract, фильтрация по нему нигде не реализована
3. **DirectorPanel привязан к двум разным tenant'ам одновременно** — диалоги через `emu`, настройки через `dev`
4. **`/debug/dialogs` загружает ВСЕ 500 событий** и фильтрует в памяти — не масштабируется

### Варианты исправления

**Вариант A (минимальный):** Установить `source: "telegram"` в `buildIngestPayload`:
```js
// bot.js:57
export function buildIngestPayload(ctx) {
  return {
    source: "telegram",        // <-- добавить
    tenant_id: process.env.DEFAULT_TENANT_ID || "dev",
    channel: "telegram",
    ...
  };
}
```
Это разделит симулятор (source=emu) и Telegram (source=telegram). Фильтр tenant_id=emu перестанет находить TG-события.

**Вариант B (правильный):** Привести к архитектуре из ingest_contract:
- Поднять `tenant_id` и `channel` на top-level полей в таблице `events`
- Фильтровать на уровне БД: `WHERE tenant_id = $1`
- Добавить `channel` в UI как дополнительный фильтр
- DirectorPanel: использовать единый tenant_id

### Приоритет
**Средний.** Баг не вызывает потерю данных, но создаёт путаницу в UI. Вариант A — quick fix на 5 минут. Вариант B — системное решение, требует миграции БД.

---

*Исследование проведено без внесения изменений в код.*
