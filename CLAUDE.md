# CLAUDE.md — Проект Shiftledger: Бот «Про Дети»

## Обзор проекта

Умный чат-бот для детского центра «Про Дети» (г. Северодвинск, 2 филиала). Бот обрабатывает запросы родителей через ВКонтакте: запись на занятия, вопросы о расписании, ценах, абонементах, правилах центра.

Архитектура основана на ядре NEXA (~/Nexa/) — гибрид LLM + детерминированная бизнес-логика.

## Стек

- **Runtime:** Node.js 18+ / TypeScript
- **Framework:** NestJS (аналогично ~/Nexa/)
- **LLM:** OpenAI gpt-4o-mini (intent classification + response generation)
- **Database:** PostgreSQL + Prisma ORM
- **Messaging:** VK Community API (webhooks)
- **Deploy:** Render

## Структура проекта

```
~/shiftledger-pro-deti/
├── CLAUDE.md                    # Этот файл
├── bot_config/
│   ├── system_prompt.md         # Системный промпт бота
│   ├── fsm_config.json          # FSM: интенты, состояния, переходы
│   └── intent_classifier_prompt.json  # Промпт классификатора интентов
├── knowledge_base/
│   ├── knowledge_base.json      # База знаний (правила, инфо о центре)
│   ├── rules_plain.txt          # Правила центра (текст для промптов)
│   ├── style_guide.md           # Гайд по стилю общения
│   ├── few_shot_examples.json   # Эталонные ответы (v1, rule-based)
│   ├── few_shot_examples_v2.json # Эталонные ответы (v2, после OpenAI)
│   ├── golden_pairs.json        # Золотые QA-пары (v1)
│   └── golden_pairs_v2.json     # Золотые QA-пары (v2, 9109 пар, 17 интентов)
├── annotated_qa_v2.json         # Размеченный датасет (20524 пары)
├── sessions_meta.json           # Метаданные 14023 сессий
└── scripts/                     # Пайплайн обработки данных
    ├── 01_reconstruct_dialogs.py
    ├── 02_extract_knowledge.py
    ├── 03_annotate_intents.py
    └── 04_classify_openai.py
```

## Ключевые файлы для разработки бота

1. **bot_config/system_prompt.md** — главный промпт, определяет поведение бота
2. **bot_config/fsm_config.json** — конфигурация FSM: 20 интентов, 5 состояний, auto-responses
3. **bot_config/intent_classifier_prompt.json** — промпт для real-time классификации сообщений
4. **knowledge_base/rules_plain.txt** — правила центра, вставляются в контекст LLM
5. **knowledge_base/few_shot_examples_v2.json** — лучшие примеры для few-shot learning

## Архитектура бота

```
VK Webhook → Message Router → Intent Classifier (LLM)
                                      ↓
                               FSM State Machine
                              /        |         \
                    auto_response   handler    escalate_to_admin
                         ↓             ↓              ↓
                    send_reply    LLM generate    notify_admin
                                  + KB context
```

### Три режима ответа:

1. **auto_response** — шаблонный ответ без LLM (GREETING, CONTINUATION, BOOKING_CONFIRM, FEEDBACK_POSITIVE)
2. **handler + LLM** — бот отвечает сам, используя system_prompt + rules + few-shot (AGE_GROUP, GENERAL_QUESTION, MAKEUP_CLASS — когда может ответить из правил)
3. **escalate** — передаёт администратору с контекстом (PRICING с конкретными суммами, BOOKING с проверкой мест, FEEDBACK_NEGATIVE, нестандартные запросы)

### Бюджетный контроль:
- Intent classification: ~$0.001 за сообщение (gpt-4o-mini)
- Response generation: ~$0.003 за сообщение
- Auto-responses и шаблоны: $0
- Лимит: $50/месяц

## Данные

- **69 414** реальных сообщений за 4.6 года (VK)
- **20 524** QA-пары, размечены по 20 интентам
- **9 109** золотых пар для обучения
- **7 операторов** — стиль общения извлечён и задокументирован

## Стиль общения (извлечён из данных)

- Обращение на «Вы», по имени
- Эмодзи: ✅ 🌷 🌸 ☀ 😔 (1.09 на сообщение)
- Средний ответ: 137 символов, 2-3 предложения
- Подтверждение записи: всегда с ✅
- Сожаление: с 😔
- Цветочные эмодзи для дружелюбности

## Связь с NEXA

Этот проект — клон архитектуры NEXA, адаптированный под детский центр:
- FSM engine → из ~/Nexa/src/bot/
- LLM client → из ~/Nexa/src/llm/
- Webhook handler → адаптировать под VK API (у NEXA — Telegram)
- Knowledge service → новая база знаний из knowledge_base/

## Команды

```bash
# Разработка
npm run start:dev

# Тесты
npm run test
npm run test:e2e

# База данных
npx prisma migrate dev
npx prisma studio

# Деплой
git push origin main  # auto-deploy на Render
```

## Переменные окружения (.env)

```
DATABASE_URL=postgresql://...
OPENAI_API_KEY=sk-...          # Из ~/Nexa/.env
VK_GROUP_TOKEN=...             # Токен сообщества ВК
VK_CONFIRMATION_CODE=...       # Код подтверждения вебхука
VK_SECRET=...                  # Secret key для вебхука
ADMIN_VK_ID=...                # VK ID администратора для эскалации
```
