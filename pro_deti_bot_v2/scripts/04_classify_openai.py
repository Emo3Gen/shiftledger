#!/usr/bin/env python3
"""
ЭТАП 4: LLM-классификация через OpenAI Batch API
===================================================

Готовит батч-файлы в формате OpenAI Batch API (JSONL)
для классификации 10900 пар с интентом OTHER.

Использование:
  1. python3 04_classify_openai.py --prepare   → создаёт JSONL батчи
  2. Загрузить батчи в OpenAI Batch API
  3. python3 04_classify_openai.py --merge      → мерджит результаты

Модель: gpt-4o-mini (оптимальное соотношение цена/качество)
Формат ответа: structured JSON (response_format)
"""

import json
import os
import sys
import hashlib
from collections import Counter, defaultdict

OUTPUT_DIR = "/home/claude/shiftledger/output"
KB_DIR = "/home/claude/shiftledger/knowledge_base"
BATCH_DIR = os.path.join(OUTPUT_DIR, "openai_batches")

# Расширенная таксономия для LLM
INTENT_TAXONOMY = {
    "TRIAL_BOOKING": "Запись на пробное/ознакомительное занятие",
    "BOOKING": "Запись на обычное занятие / проверка наличия мест",
    "BOOKING_CONFIRM": "Подтверждение записи клиентом (да, запишите, придём)",
    "PRICING": "Вопросы о ценах, абонементах, оплате, ссылки на оплату",
    "SCHEDULE": "Расписание, время занятий, дни недели",
    "CANCELLATION": "Отмена визита, пропуск занятия, болезнь ребёнка",
    "MAKEUP_CLASS": "Отработка пропущенного занятия, перенос",
    "AGE_GROUP": "Вопрос о возрасте, подходящих группах, направлениях",
    "LOCATION": "Адрес центра, как добраться, какой филиал",
    "RENEWAL": "Продление/покупка нового абонемента на следующий месяц",
    "PERSONAL_DATA": "Клиент сообщает данные: имя ребёнка, телефон, возраст (без вопроса)",
    "RESCHEDULE": "Перенос на другой день/время (не отработка, а смена слота)",
    "FREEZE": "Заморозка абонемента, приостановка посещений",
    "FEEDBACK_POSITIVE": "Благодарность, положительный отзыв",
    "FEEDBACK_NEGATIVE": "Жалоба, недовольство",
    "GENERAL_QUESTION": "Общий вопрос об услугах, правилах, документах, лицензии",
    "PHOTO_REQUEST": "Запрос фото/видео с занятия",
    "CONTINUATION": "Продолжение диалога (ОК, поняла, хорошо) без нового запроса",
    "GREETING": "Приветствие без конкретного запроса",
    "OTHER": "Не подходит ни под одну категорию",
}

SYSTEM_PROMPT = """Ты — эксперт по классификации обращений в детский центр развития для детей.

Контекст: Детский центр «Про Дети» в г. Северодвинск. Два филиала. Занятия для детей от 8 месяцев до 7 лет. Группы: Мини-1 (самые маленькие), Мини-2, Старт-1, Старт-2, подготовка к школе, ГКП (группа кратковременного пребывания). Абонементная система, пробные занятия, отработки пропущенных занятий.

Для каждой пары «сообщение клиента → ответ оператора» определи:

1. **intent** — один из:
{intents}

2. **confidence** — уверенность в классификации (0.0 - 1.0)

3. **entities** — извлечённые сущности (JSON объект), любые из:
   - child_name: имя ребёнка
   - child_age: возраст (строкой, как написал клиент)
   - date_ref: упоминание даты/дня
   - time_ref: упоминание времени
   - group_type: тип группы (мини-1, старт-2 и т.д.)
   - phone: номер телефона
   - center: филиал/адрес

Отвечай СТРОГО в формате JSON, без markdown, без пояснений:
{{"intent": "...", "confidence": 0.95, "entities": {{...}}}}"""

def build_system_prompt():
    """Формирует system prompt с таксономией"""
    intent_lines = "\n".join(
        f"   - **{name}**: {desc}" for name, desc in INTENT_TAXONOMY.items()
    )
    return SYSTEM_PROMPT.format(intents=intent_lines)


def prepare_batches(max_items=None, batch_size=1000):
    """
    Готовит JSONL-файлы для OpenAI Batch API.
    Формат: https://platform.openai.com/docs/guides/batch
    """
    os.makedirs(BATCH_DIR, exist_ok=True)

    # Load annotated QA pairs
    with open(os.path.join(OUTPUT_DIR, "annotated_qa.json"), "r", encoding="utf-8") as f:
        all_qa = json.load(f)

    # Filter OTHER
    others = [qa for qa in all_qa if qa["intent"] == "OTHER"]
    if max_items:
        others = others[:max_items]

    print(f"Preparing batches for {len(others)} OTHER pairs")
    print(f"Batch size: {batch_size}")

    system_prompt = build_system_prompt()

    batch_files = []
    for batch_idx in range(0, len(others), batch_size):
        batch = others[batch_idx:batch_idx + batch_size]
        batch_filename = f"batch_{batch_idx // batch_size:03d}.jsonl"
        batch_path = os.path.join(BATCH_DIR, batch_filename)

        with open(batch_path, "w", encoding="utf-8") as f:
            for qa in batch:
                # Create unique custom_id
                raw_id = qa["session_id"] + "_" + qa["client_text"][:50]
                custom_id = "qa_" + hashlib.md5(raw_id.encode()).hexdigest()[:12]

                # User message with context
                user_msg = f"""Сообщение клиента: {qa["client_text"][:500]}

Ответ оператора: {qa["staff_text"][:500]}"""

                request = {
                    "custom_id": custom_id,
                    "method": "POST",
                    "url": "/v1/chat/completions",
                    "body": {
                        "model": "gpt-4o-mini",
                        "temperature": 0.1,
                        "max_tokens": 200,
                        "response_format": {"type": "json_object"},
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_msg},
                        ],
                    },
                }

                f.write(json.dumps(request, ensure_ascii=False) + "\n")

        batch_files.append(batch_path)
        print(f"  Created: {batch_filename} ({len(batch)} items)")

    # Also save the mapping custom_id → original qa index
    mapping = {}
    idx = 0
    for qa in others:
        raw_id = qa["session_id"] + "_" + qa["client_text"][:50]
        custom_id = "qa_" + hashlib.md5(raw_id.encode()).hexdigest()[:12]
        mapping[custom_id] = {
            "index": idx,
            "session_id": qa["session_id"],
            "client_text": qa["client_text"][:100],
        }
        idx += 1

    with open(os.path.join(BATCH_DIR, "id_mapping.json"), "w", encoding="utf-8") as f:
        json.dump(mapping, f, ensure_ascii=False, indent=2)

    # Cost estimate
    # gpt-4o-mini: ~$0.15/1M input, ~$0.60/1M output tokens
    # Batch API: 50% discount
    avg_input_tokens = 350  # system + user
    avg_output_tokens = 50
    total_items = len(others)
    input_cost = (total_items * avg_input_tokens / 1_000_000) * 0.15 * 0.5  # batch discount
    output_cost = (total_items * avg_output_tokens / 1_000_000) * 0.60 * 0.5
    total_cost = input_cost + output_cost

    print(f"\n=== Cost estimate ===")
    print(f"  Items: {total_items}")
    print(f"  Estimated input tokens: {total_items * avg_input_tokens:,}")
    print(f"  Estimated output tokens: {total_items * avg_output_tokens:,}")
    print(f"  Estimated cost (batch, 50% off): ${total_cost:.2f}")
    print(f"  Batch files: {len(batch_files)}")

    # Instructions
    print(f"""
=== Upload Instructions ===

1. Install OpenAI CLI or use Python SDK:

   pip install openai

2. Upload batch file:

   from openai import OpenAI
   client = OpenAI()

   for batch_file in {[os.path.basename(f) for f in batch_files]}:
       file = client.files.create(
           file=open(f"openai_batches/{{batch_file}}", "rb"),
           purpose="batch"
       )
       batch = client.batches.create(
           input_file_id=file.id,
           endpoint="/v1/chat/completions",
           completion_window="24h"
       )
       print(f"Batch {{batch.id}} created")

3. Check status:
   batch = client.batches.retrieve("batch_xxx")
   print(batch.status)

4. Download results:
   content = client.files.content(batch.output_file_id)
   content.write_to_file("results.jsonl")

5. Run merge:
   python3 04_classify_openai.py --merge results.jsonl
""")

    return batch_files


def prepare_direct_api_script():
    """
    Генерирует Python-скрипт для прямого вызова OpenAI API
    (альтернатива Batch API, для тестирования или малых объёмов)
    """
    script = '''#!/usr/bin/env python3
"""
Direct OpenAI API calls for intent classification.
For testing or small batches (<100 items).
For large volumes, use Batch API (04_classify_openai.py --prepare).

Usage:
  export OPENAI_API_KEY=sk-...
  python3 classify_direct.py [--limit 100]
"""

import json
import os
import sys
import time
import argparse

try:
    from openai import OpenAI
except ImportError:
    print("pip install openai")
    sys.exit(1)

OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))

def classify_batch(items, client, system_prompt, model="gpt-4o-mini"):
    """Classify a list of QA pairs"""
    results = []
    for i, qa in enumerate(items):
        try:
            response = client.chat.completions.create(
                model=model,
                temperature=0.1,
                max_tokens=200,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"""Сообщение клиента: {qa["client_text"][:500]}

Ответ оператора: {qa["staff_text"][:500]}"""},
                ],
            )
            result = json.loads(response.choices[0].message.content)
            result["session_id"] = qa["session_id"]
            result["original_index"] = i
            results.append(result)

            if (i + 1) % 50 == 0:
                print(f"  Processed {i + 1}/{len(items)}")

        except Exception as e:
            print(f"  Error on item {i}: {e}")
            results.append({
                "session_id": qa["session_id"],
                "intent": "ERROR",
                "confidence": 0,
                "entities": {},
                "error": str(e),
            })

        # Rate limit respect
        time.sleep(0.1)

    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--model", default="gpt-4o-mini")
    args = parser.parse_args()

    client = OpenAI()

    with open(os.path.join(OUTPUT_DIR, "annotated_qa.json")) as f:
        all_qa = json.load(f)

    others = [qa for qa in all_qa if qa["intent"] == "OTHER"][:args.limit]
    print(f"Classifying {len(others)} items with {args.model}...")

    # Load system prompt from batch config
    with open(os.path.join(OUTPUT_DIR, "openai_batches", "system_prompt.txt")) as f:
        system_prompt = f.read()

    results = classify_batch(others, client, system_prompt, args.model)

    outpath = os.path.join(OUTPUT_DIR, "openai_batches", "direct_results.json")
    with open(outpath, "w") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    # Stats
    from collections import Counter
    intents = Counter(r.get("intent") for r in results)
    print(f"\\nResults:")
    for intent, count in intents.most_common():
        print(f"  {intent}: {count}")

    print(f"\\nSaved to {outpath}")


if __name__ == "__main__":
    main()
'''
    script_path = os.path.join(OUTPUT_DIR, "classify_direct.py")
    with open(script_path, "w") as f:
        f.write(script)
    print(f"  Created: classify_direct.py")
    return script_path


def merge_results(results_path=None):
    """Мерджит результаты из OpenAI обратно в annotated_qa.json"""

    # Load original annotated data
    with open(os.path.join(OUTPUT_DIR, "annotated_qa.json"), "r", encoding="utf-8") as f:
        all_qa = json.load(f)

    # Load mapping
    with open(os.path.join(BATCH_DIR, "id_mapping.json"), "r", encoding="utf-8") as f:
        mapping = json.load(f)

    # Load results
    if results_path is None:
        results_path = os.path.join(BATCH_DIR, "results.jsonl")

    results = {}
    with open(results_path, "r", encoding="utf-8") as f:
        for line in f:
            try:
                item = json.loads(line)
                custom_id = item["custom_id"]
                response = item["response"]["body"]["choices"][0]["message"]["content"]
                parsed = json.loads(response)
                results[custom_id] = parsed
            except Exception as e:
                print(f"  Error parsing result: {e}")

    print(f"  Loaded {len(results)} results")

    # Merge back
    others_idx = 0
    updated = 0
    for qa in all_qa:
        if qa["intent"] == "OTHER":
            raw_id = qa["session_id"] + "_" + qa["client_text"][:50]
            custom_id = "qa_" + hashlib.md5(raw_id.encode()).hexdigest()[:12]
            if custom_id in results:
                r = results[custom_id]
                qa["intent"] = r.get("intent", "OTHER")
                qa["intent_confidence"] = r.get("confidence", 0)
                if r.get("entities"):
                    qa["entities"].update(r["entities"])
                qa["classified_by"] = "openai_batch"
                updated += 1
            others_idx += 1

    print(f"  Updated {updated}/{others_idx} OTHER pairs")

    # Save updated dataset
    outpath = os.path.join(OUTPUT_DIR, "annotated_qa_v2.json")
    with open(outpath, "w", encoding="utf-8") as f:
        json.dump(all_qa, f, ensure_ascii=False, indent=2)
    print(f"  Saved: {outpath}")

    # Print new distribution
    from collections import Counter
    intents = Counter(qa["intent"] for qa in all_qa)
    print(f"\n  Updated intent distribution:")
    for intent, count in intents.most_common():
        print(f"    {intent:>20}: {count}")


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "--prepare"

    print("\n" + "=" * 70)
    print("ЭТАП 4: КЛАССИФИКАЦИЯ ЧЕРЕЗ OPENAI")
    print("=" * 70)

    if mode == "--prepare":
        print("\n[1/2] Подготовка батч-файлов...")
        batch_files = prepare_batches()

        print("\n[2/2] Генерация скрипта прямого вызова...")
        prepare_direct_api_script()

        # Save system prompt separately
        with open(os.path.join(BATCH_DIR, "system_prompt.txt"), "w", encoding="utf-8") as f:
            f.write(build_system_prompt())

        print(f"\n✅ Батчи готовы в {BATCH_DIR}/")

    elif mode == "--merge":
        results_path = sys.argv[2] if len(sys.argv) > 2 else None
        print("\nМерджим результаты...")
        merge_results(results_path)
        print("\n✅ Результаты смержены")

    else:
        print(f"Unknown mode: {mode}")
        print("Usage: python3 04_classify_openai.py [--prepare | --merge [results.jsonl]]")


if __name__ == "__main__":
    main()
