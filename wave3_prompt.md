Выполни четыре задачи последовательно. После каждой задачи сделай git commit. Работай автономно.

Перед началом: прочитай текущее состояние проекта — server.js, package.json, структуру папок, middleware/, routes/. Учти изменения Волн 1 и 2 (auth middleware, Zod validation, employeeService, slotService, тесты).

---

## Задача 1/4: Логирование (pino) + Rate Limiting

### Логирование

1. Установи: npm install pino pino-pretty

2. Создай backend/logger.js:
   - Экспортирует настроенный pino-логгер
   - В dev-режиме (NODE_ENV !== 'production'): pino-pretty с цветами и timestamps
   - В production: JSON-формат (стандартный pino)
   - Уровень по умолчанию: info (переопределяется через LOG_LEVEL env)

3. Создай backend/middleware/requestLogger.js:
   - Express middleware, логирует каждый запрос:
     - method, url, status_code, response_time_ms
     - trace_id (из заголовка x-trace-id или генерируется uuid)
     - Прикрепляет req.log = logger.child({ trace_id }) для использования в хэндлерах
   - Не логирует тело запроса/ответа (privacy)
   - Для ошибок (4xx, 5xx) — уровень warn/error

4. Замени все console.log/console.warn/console.error в server.js и других модулях на logger:
   - logger.info(), logger.warn(), logger.error()
   - В catch-блоках: logger.error({ err, trace_id }, 'описание')
   - При старте сервера: logger.info({ port }, 'Server started')

5. Добавь LOG_LEVEL=info в .env.example

### Rate Limiting

6. Установи: npm install express-rate-limit

7. Создай backend/middleware/rateLimiter.js:
   - Экспортирует два лимитера:

   a) generalLimiter — для всех эндпоинтов:
      - windowMs: 15 * 60 * 1000 (15 минут)
      - max: 100 запросов
      - standardHeaders: true
      - message: { error: "Too many requests", retry_after_seconds: ... }

   b) ingestLimiter — для /ingest и /debug/send (более строгий):
      - windowMs: 1 * 60 * 1000 (1 минута)
      - max: 30 запросов
      - message: { error: "Too many messages, slow down" }

8. Подключи в server.js:
   - app.use(generalLimiter) — глобально
   - app.post('/ingest', ingestLimiter, ...) — дополнительно на ingest
   - app.post('/debug/send', ingestLimiter, ...) — дополнительно на debug/send

9. Добавь в .env.example:
   - RATE_LIMIT_GENERAL=100
   - RATE_LIMIT_INGEST=30

10. Обнови существующие тесты если они ломаются из-за логгера (мок pino в тестах).

git commit -m "feat: add pino logging and express-rate-limit"

---

## Задача 2/4: Telegram-бот

1. Установи: npm install grammy

2. Создай backend/telegram/bot.js:

   - Импорт: const { Bot } = require('grammy')
   - Читает TELEGRAM_BOT_TOKEN из process.env
   - Если токен не задан — экспортирует заглушку с логом предупреждения

   - Обработчик message:text:
     a) Извлекает из ctx: chat.id, from.id, from.first_name, message.message_id, message.date, message.text
     b) Формирует ingest payload по контракту:
        {
          tenant_id: process.env.DEFAULT_TENANT_ID || "dev",
          channel: "telegram",
          chat_id: String(ctx.chat.id),
          user_id: String(ctx.from.id),
          message_id: String(ctx.message.message_id),
          ts: new Date(ctx.message.date * 1000).toISOString(),
          text: ctx.message.text,
          meta: {
            role: "staff",
            telegram: {
              chat_type: ctx.chat.type,
              first_name: ctx.from.first_name,
              username: ctx.from.username
            }
          }
        }
     c) Отправляет POST на внутренний /ingest (через fetch к localhost или напрямую вызывает ingest-логику)
     d) Получает результат (facts)
     e) Отвечает пользователю:
        - Если facts найдены: "✅ Принято: [краткое описание фактов]"
          Пример: "✅ Принято: доступность пн 10:00–13:00"
        - Если facts пустые: "📝 Записано, но не распознано как команда. Попробуйте: AVAIL mon 10-13"
        - Если ошибка: "❌ Ошибка обработки, попробуйте позже"

   - Обработчик /start:
     - Ответ: приветствие + список команд DSL + примеры

   - Обработчик /help:
     - Ответ: справка по командам (AVAIL, CANT, SWAP, GAP и русский язык)

   - Обработчик /schedule:
     - Вызывает GET /debug/schedule для текущего чата
     - Форматирует и отправляет расписание на неделю

3. Создай backend/telegram/formatters.js:
   - formatFacts(facts) — человекочитаемое описание фактов на русском
   - formatSchedule(schedule) — таблица расписания для Telegram (моноширинный текст)

4. Интегрируй в server.js:
   - При старте сервера, если TELEGRAM_BOT_TOKEN задан:
     - const bot = require('./telegram/bot')
     - bot.start() (long polling) или bot.api.setWebhook(WEBHOOK_URL) для webhook
   - Добавь флаг TELEGRAM_MODE=polling|webhook в .env.example

5. Добавь в .env.example:
   - TELEGRAM_BOT_TOKEN=
   - TELEGRAM_MODE=polling
   - DEFAULT_TENANT_ID=dev

6. Напиши 5+ тестов в backend/__tests__/telegram.test.js:
   - Корректный маппинг Telegram update → ingest payload
   - /start возвращает приветствие
   - formatFacts корректно форматирует SHIFT_AVAILABILITY
   - formatFacts для пустого массива
   - formatSchedule корректно форматирует расписание

git commit -m "feat: Telegram bot with grammy (ingest + schedule + help)"

---

## Задача 3/4: OpenAPI спецификация

1. Установи: npm install swagger-jsdoc swagger-ui-express

2. Создай backend/swagger.js:
   - Конфигурация swagger-jsdoc:
     - openapi: "3.0.0"
     - info: { title: "ShiftLedger API", version: "1.0.0", description: "API для автоматического составления расписания детской студии" }
     - servers: [{ url: "http://localhost:3000" }]
     - components.securitySchemes: { BearerAuth: { type: "http", scheme: "bearer" } }
     - security: [{ BearerAuth: [] }]
   - apis: ["./backend/routes/*.js", "./backend/server.js"]

3. Добавь JSDoc-аннотации (@openapi) к КАЖДОМУ эндпоинту:

   POST /ingest:
   - summary, requestBody (schema из Zod → описать вручную или через zod-to-openapi)
   - responses: 200, 400, 401

   GET /debug/tenants, GET /debug/dialogs, GET /debug/dialog/:id:
   - parameters, responses с примерами

   POST /debug/send:
   - requestBody, responses

   GET /debug/schedule:
   - parameters (tenant_id, chat_id, week_start), response schema

   GET/POST/PUT/DELETE /api/employees:
   - Полные CRUD-описания

   GET/POST/PUT/DELETE /api/slots:
   - Полные CRUD-описания

   POST /parse/:eventId:
   - parameters, responses

   GET /debug/week_state, POST /debug/build-schedule, GET /debug/timesheet:
   - Если существуют — добавь описания

4. Подключи в server.js:
   - app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs))
   - Логируй при старте: logger.info('Swagger UI: http://localhost:PORT/api-docs')

5. Проверь что /api-docs открывается (запусти сервер, curl http://localhost:3000/api-docs — должен вернуть HTML).

git commit -m "feat: OpenAPI 3.0 spec with Swagger UI at /api-docs"

---

## Задача 4/4: CI/CD (GitHub Actions)

1. Создай .github/workflows/ci.yml:

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    strategy:
      matrix:
        node-version: [18, 20]

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run linter
        run: npm run lint --if-present

      - name: Run tests
        run: npm test -- --coverage --forceExit
        env:
          NODE_ENV: test

      - name: Check coverage threshold
        run: |
          COVERAGE=$(npx jest --coverage --coverageReporters=json-summary --forceExit 2>/dev/null | tail -1 || true)
          echo "Coverage report generated"

      - name: Upload coverage
        if: matrix.node-version == 20
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage/

  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - name: Audit dependencies
        run: npm audit --audit-level=high || true
```

2. Создай .github/workflows/deploy.yml (заготовка):

```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test -- --forceExit
        env:
          NODE_ENV: test

      # TODO: добавить деплой на hosting (Railway/Render/VPS)
      - name: Deploy placeholder
        run: echo "Deploy step — configure for your hosting provider"
```

3. Добавь в package.json скрипты (если нет):
   - "lint": "echo 'No linter configured yet'" (или подключи eslint если хочешь)
   - Убедись что "test" вызывает jest

4. Создай .github/PULL_REQUEST_TEMPLATE.md:
```markdown
## Что изменено

## Тип изменения
- [ ] Bugfix
- [ ] Feature
- [ ] Refactor
- [ ] Documentation

## Чеклист
- [ ] Тесты проходят (`npm test`)
- [ ] Новый код покрыт тестами
- [ ] Миграции добавлены (если нужны)
```

5. Убедись что .gitignore содержит: node_modules, .env, coverage/, dist/

git commit -m "feat: CI/CD with GitHub Actions (test + security + deploy stub)"

---

## Финал

1. Запусти npm test — все тесты должны проходить (включая новые для Telegram)
2. Запусти сервер на 5 секунд, проверь:
   - Логи идут через pino (структурированный JSON или pretty)
   - http://localhost:3000/api-docs отдаёт Swagger UI
3. Выведи git log --oneline последние 4 коммита
4. Выведи финальную структуру проекта (tree)
5. Дай итоговый отчёт:
   - Что сделано
   - Что требует ручной настройки (токены, secrets в GitHub, хостинг)
   - Рекомендации на будущее
