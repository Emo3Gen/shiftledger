# Testing Plan: Commercial Release

## Simplified Business Logic (3 states)

```
COLLECTING → ACTIVE → CLOSED
```

- **COLLECTING** — bot collects availability from employees (free text in chat)
- **ACTIVE** — schedule is built and live; replacements handled automatically
- **CLOSED** — week is over, data ready for salary calculation

---

## End-to-End Scenarios

### Scenario 1: Normal Week

1. Bot sends availability request to chat (emoji/message trigger)
2. 4 employees respond with free text in different formats:
   - "пн утро/вечер, ср не могу"
   - "все дни кроме четверга"
   - "могу вт 10-13, пт вечер"
   - "свободна пн, ср, пт утро"
3. Bot parses all responses, asks one employee for clarification:
   "Дарина, правильно ли я понял: ср не можешь, вт только утро?"
4. Bot builds schedule prioritizing Karina's min 20 hours
5. Bot sends schedule to chat
6. **Verify**: all slots filled, hours correct, Karina >= 20h

### Scenario 2: Illness & Self-Organized Replacement

1. Schedule is built (state = ACTIVE)
2. Isa writes: "Девочки, я не могу выйти в четверг утро, кто сможет?"
3. Bot detects: `SHIFT_UNAVAILABILITY` with `needs_replacement: true`
4. Ksyusha responds: "Я смогу"
5. Bot detects: `SHIFT_REPLACEMENT` for thu morning
6. Bot updates schedule and notifies: "График обновлён: Чт утро — Ксюша (замена Исы)"
7. **Verify**: hours recalculated, replacement reflected, state stays ACTIVE

### Scenario 3: No Replacement — Escalation

1. Isa can't work Friday evening
2. No one responds within N hours
3. Bot notifies chat: "Смена Пт вечер не закрыта. Свободны: Карина, Дарина"
4. If still no response — bot messages director directly
5. **Verify**: escalation works, director receives notification, gap tracked in `gaps_open`

### Scenario 4: Salary Calculation

1. Week is completed (state = CLOSED)
2. Director opens mini-app
3. Sees final schedule with actual attendance (SHIFT_WORKED facts)
4. Exports salary calculation
5. **Verify**: hours = sum of slots, rates correct, Karina > 20h, overtime calculated, no-shows flagged

### Scenario 5: Incomplete Data

1. One employee doesn't respond to availability request
2. Bot reminds after 24h
3. If no response by deadline — bot builds schedule without that employee
4. Bot notifies director: "Ксюша не ответила на запрос доступности"
5. **Verify**: schedule built without missing employee, director notified, reminder sent

### Scenario 6: Conflicting Responses

1. Isa writes "могу пн утро", then later "не могу пн утро"
2. Bot takes the latest message (last-write-wins)
3. Bot asks for clarification: "Иса, ты сначала написала что можешь в Пн утро, потом что не можешь. Какой вариант правильный?"
4. **Verify**: latest fact wins, clarification sent, no duplicate assignments

---

## Pre-Release Checklist

- [ ] All 6 scenarios pass end-to-end
- [ ] NL parser recognizes > 90% of real Russian phrases
- [ ] Replacements from chat conversation detected correctly (`needs_replacement` + `SHIFT_REPLACEMENT`)
- [ ] Pre-arranged agreements enforced (Karina min 20h via `minHours` in userDirectory)
- [ ] Director does NOT receive unnecessary notifications (only escalations)
- [ ] Employees see only the final result, not change history
- [ ] Salary calculated correctly from final schedule (timesheetV0)
- [ ] Telegram bot runs stable (no crashes for 24h continuous operation)
- [ ] Escalation to director works when no replacement found
- [ ] Supabase data is consistent (facts immutable, no orphaned records)

---

## Current Test Coverage

| Module | Tests | Status |
|---|---|---|
| factsParserV0 | 65 tests (DSL + NL + short forms + replacements + swaps) | Passing |
| scheduleEngineV0 | 15 tests (assignments, gaps, seniors, Karina priority) | Passing |
| weekStateV0 | 14 tests (3-state machine, gaps, lifecycle) | Passing |
| timesheetV0 | 10 tests (salary, overtime, no-show) | Passing |
| validation | 15 tests (Zod schemas, middleware) | Passing |
| telegram | 19 tests (payload, formatting, schedule display) | Passing |
| slotService | 11 tests (custom slots, defaults) | Passing |

**Total: 150 tests, all passing**

---

## What's NOT Yet Implemented (for scenarios to fully work)

| Feature | Scenario | Priority |
|---|---|---|
| Bot-initiated availability collection (cron/trigger) | 1, 5 | High |
| Clarification questions from bot | 1, 6 | High |
| Automatic replacement detection from chat thread context | 2 | High |
| Escalation timer (N hours with no replacement) | 3 | Medium |
| Director notification channel (separate from employee chat) | 3, 5 | Medium |
| Reminder system for non-responders | 5 | Medium |
| Conflict detection and resolution prompts | 6 | Medium |
| Mini-app salary export UI | 4 | Low (backend ready) |
