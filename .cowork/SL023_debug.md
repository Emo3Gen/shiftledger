# SL-023 Диагностика: кэш пустой после деплоя

## getOrLoadFacts — полный код (после исправления)

```javascript
async function getOrLoadFacts(chatId) {
  if (_factsCache.has(chatId) && _factsCache.get(chatId).size > 0) {
    const facts = Array.from(_factsCache.get(chatId).values());
    logger.debug({ chatId, count: facts.length }, "[facts-cache] hit");
    return facts;
  }
  logger.info({ chatId }, "[facts-cache] miss, loading from DB");
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - FACTS_CACHE_MAX_AGE_DAYS);
  const { data: dbFacts, error: dbErr } = await supabase
    .from("facts").select("*")
    .eq("chat_id", chatId)
    .gte("created_at", cutoff.toISOString())
    .order("created_at", { ascending: true })
    .limit(5000);
  if (dbErr) {
    logger.error({ chatId, err: dbErr }, "[facts-cache] DB load error");
    return [];
  }
  if (dbFacts) {
    const cached = initCacheFromDB(chatId, dbFacts);
    logger.info({ chatId, dbRows: dbFacts.length, cached }, "[facts-cache] loaded from DB");
    return getFactsForChat(chatId);
  }
  return [];
}
```

## Найденная проблема #1: неэффективный cache-check (исправлена)

Старый код:
```javascript
let facts = getFactsForChat(chatId);       // returns [] for empty Map
if (facts.length > 0) return facts;        // falls through
// ... re-queries DB every time
```

Это не вызывало "пустой кэш", но создавало N+1 запросов к DB на каждый вызов
если кэш пуст (например, чат без фактов).

**Исправлено:** проверяем `_factsCache.has(chatId) && size > 0`.

## Найденная проблема #2: нет логирования ошибок DB

Старый код не проверял `error` от Supabase:
```javascript
const { data: dbFacts } = await supabase...  // error ignored!
```

Если Supabase возвращает ошибку (RLS, timeout, connection), `dbFacts` будет null,
и функция тихо вернёт `[]`.

**Исправлено:** добавлен `error: dbErr` + логирование.

## Диагностический эндпоинт

Добавлен `GET /debug/cache-status?chat_id=...`:
- `factsReturned` — сколько фактов вернул getOrLoadFacts
- `cacheSize` — размер Map в _factsCache
- `dbCountWithCutoff` — сколько строк в DB с фильтром cutoff
- `dbCountAll` — сколько строк в DB без фильтра
- `cutoffDate` — дата отсечки (60 дней назад)
- `sampleFact` — первый факт для проверки формата

## Добавленное логирование

В `getOrLoadFacts`:
- `[facts-cache] hit` — кэш попадание (debug уровень)
- `[facts-cache] miss, loading from DB` — промах кэша (info)
- `[facts-cache] DB load error` — ошибка Supabase (error)
- `[facts-cache] loaded from DB` — успешная загрузка (info, с dbRows и cached counts)

## Возможные причины пустого кэша

1. **Ошибка Supabase** — ранее игнорировалась, теперь логируется
2. **Неверный chat_id** — проверить через `/debug/cache-status`
3. **Факты без created_at** — не пройдут `gte` фильтр
4. **Все факты старше 60 дней** — не для данного кейса (факты от 02-03.04.2026)

## Критерии готовности

После деплоя:
```bash
curl -s ".../debug/cache-status?chat_id=-1002789466545"
# Ожидание: factsReturned > 0, dbCountAll > 0

curl -s ".../debug/schedule?chat_id=-1002789466545&week_start=2026-04-06" | python3 -c "
import sys,json; d=json.load(sys.stdin)
print('facts_count:', d.get('meta',{}).get('facts_count'))
print('assignments:', len(d.get('assignments',[])))
"
# Ожидание: facts_count > 100, assignments > 5
```
