## Facts Pipeline v1 — архитектура

**Цель:** детерминированно превращать сырые chat events в структурированные facts, пригодные для расчёта смен, уборок и доп.занятий.

### Модульная декомпозиция

- **Ingest (приём события)**  
  - HTTP endpoint `/ingest` в `backend/server.js`.  
  - Принимает валидированный JSON, генерирует `trace_id`, нормализует поля и пишет raw‑event в таблицу `public.events` (Supabase).  
  - Single source of truth для входящих сообщений — **только** таблица `public.events`.

- **Parse (извлечение фактов)**  
  - Локальный модуль `backend/factsParserV0.js`, экспортирующий `parseEventToFacts(event)`.  
  - На вход получает объект события (минимум: `text`, `received_at`, `chat_id`, `user_id`, `meta`).  
  - На выходе даёт массив фактов `{ fact_type, fact_payload, confidence }`.  
  - Парсер детерминированный, без LLM, на основе правил/regex.

- **Persist (запись фактов)**  
  - После успешного insert в `public.events` вызывается парсер.  
  - Каждый факт оборачивается метаданными: `event_id`, `trace_id`, `chat_id`, `user_id`, `status`, `parser_version`, `fact_hash`.  
  - Факты пишутся в таблицу `public.facts` через `upsert` по `fact_hash` (идемпотентность).

- **Reprocess (пересчёт / другой парсер)**  
  - Отдельные ручки (`/parse/:eventId` и будущие batch‑процессы) могут повторно прогонять event через нужную версию парсера.  
  - Новые факты также пишутся в `public.facts` с другим `parser_version` и/или другим `fact_type`, но по тому же `event_id`.

### Single Source of Truth

- **Raw события:**  
  - Источником истины о том, “что сказал пользователь и когда”, является таблица `public.events`.  
  - Любой пересчёт facts **обязан** опираться только на `public.events` (не на кэш, не на сторонние системы).

- **Facts как производные данные:**  
  - `public.facts` — производный слой над `public.events`.  
  - Любой факт всегда связан с одним `event_id` и может быть пересчитан.

### Схема данных (словами)

- `public.events` (сырые события):
  - `id` — PK.  
  - `trace_id` — трейс для end‑to‑end отладки.  
  - `source` — канал (`emu`/`telegram`/`mobile`/и т.п.).  
  - `chat_id`, `user_id` — логические идентификаторы чата и пользователя.  
  - `text` — оригинальный текст сообщения.  
  - `role` — роль отправителя (если известна).  
  - `meta` — JSONB с любыми доп. полями (tenant, channel‑specific payload и т.д.).  
  - `status` — жизненный цикл события (`received`/`parsed`/...).  
  - `received_at` — когда событие принято ingest‑слоем.

- `public.facts` (структурированные факты):
  - `id` — PK.  
  - `event_id` — FK на `public.events.id`.  
  - `trace_id`, `chat_id`, `user_id` — копируются для удобной выборки/дебага.  
  - `fact_type` — тип факта (`CLEANING_DONE`, `SHIFT_AVAILABILITY`, `SHIFT_SWAP_REQUEST`, ...).  
  - `fact_payload` — JSONB, строго структурированное содержимое факта (даты, смены, статусы).  
  - `confidence` — числовая оценка уверенности правила.  
  - `status` — статус факта (`parsed`/`draft`/`confirmed`/`rejected`/`applied`).  
  - `parser_version` — строка версии парсера (`v0`, `v1`, ...).  
  - `fact_hash` — детерминированный ключ идемпотентности для upsert’ов.  
  - `created_at`, `updated_at` — аудиторные поля.

