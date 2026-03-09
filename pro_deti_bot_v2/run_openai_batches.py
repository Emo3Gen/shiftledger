#!/usr/bin/env python3
"""
Прогон батчей через OpenAI Batch API — для Claude Code
========================================================

Полный цикл: загрузка файлов → создание батчей → ожидание → скачивание → мердж.

Запуск:
  cd /path/to/pro_deti_bot_v2/    # распакованный архив
  export OPENAI_API_KEY=sk-...
  python3 run_openai_batches.py

Или поэтапно:
  python3 run_openai_batches.py --upload      # загрузить файлы и создать батчи
  python3 run_openai_batches.py --status      # проверить статус
  python3 run_openai_batches.py --download    # скачать результаты
  python3 run_openai_batches.py --merge       # объединить в итоговый датасет

Требования:
  pip install openai
"""

import json
import os
import sys
import time
import glob
import hashlib
import argparse
from pathlib import Path
from datetime import datetime
from collections import Counter

try:
    from openai import OpenAI
except ImportError:
    print("❌ OpenAI SDK не установлен. Выполни:")
    print("   pip install openai")
    sys.exit(1)


# ============================================================
# КОНФИГУРАЦИЯ
# ============================================================

BATCH_DIR = "openai_batches"
RESULTS_DIR = "openai_results"
STATE_FILE = os.path.join(BATCH_DIR, "batch_state.json")

# ============================================================
# УТИЛИТЫ
# ============================================================

def load_state():
    """Загрузка состояния батчей из файла"""
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {"batches": {}, "created_at": None}


def save_state(state):
    """Сохранение состояния"""
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)


# ============================================================
# UPLOAD — загрузка файлов и создание батчей
# ============================================================

def cmd_upload():
    """Загружает JSONL файлы в OpenAI и создаёт батчи"""
    client = OpenAI()
    state = load_state()
    state["created_at"] = datetime.now().isoformat()

    batch_files = sorted(glob.glob(os.path.join(BATCH_DIR, "batch_*.jsonl")))
    if not batch_files:
        print(f"❌ Нет файлов batch_*.jsonl в {BATCH_DIR}/")
        return

    print(f"📤 Загрузка {len(batch_files)} батч-файлов в OpenAI...\n")

    for filepath in batch_files:
        filename = os.path.basename(filepath)

        # Пропуск уже загруженных
        if filename in state["batches"] and state["batches"][filename].get("batch_id"):
            print(f"  ⏩ {filename} — уже загружен (batch: {state['batches'][filename]['batch_id']})")
            continue

        try:
            # 1. Загрузка файла
            print(f"  📁 {filename} — загрузка файла...", end=" ", flush=True)
            with open(filepath, "rb") as f:
                file_obj = client.files.create(file=f, purpose="batch")
            print(f"file_id={file_obj.id}", end=" ", flush=True)

            # 2. Создание батча
            batch = client.batches.create(
                input_file_id=file_obj.id,
                endpoint="/v1/chat/completions",
                completion_window="24h",
            )
            print(f"→ batch_id={batch.id} ✅")

            state["batches"][filename] = {
                "file_id": file_obj.id,
                "batch_id": batch.id,
                "status": batch.status,
                "created_at": datetime.now().isoformat(),
            }
            save_state(state)

            # Небольшая пауза между загрузками
            time.sleep(1)

        except Exception as e:
            print(f"❌ Ошибка: {e}")
            state["batches"][filename] = {"error": str(e)}
            save_state(state)

    print(f"\n✅ Загружено батчей: {sum(1 for b in state['batches'].values() if b.get('batch_id'))}")
    print(f"   Состояние сохранено в {STATE_FILE}")


# ============================================================
# STATUS — проверка статуса батчей
# ============================================================

def cmd_status(poll=False, poll_interval=30):
    """Проверяет статус всех батчей"""
    client = OpenAI()
    state = load_state()

    if not state["batches"]:
        print("❌ Нет загруженных батчей. Сначала: python3 run_openai_batches.py --upload")
        return False

    while True:
        print(f"\n📊 Статус батчей ({datetime.now().strftime('%H:%M:%S')})")
        print("-" * 65)

        all_done = True
        has_errors = False

        for filename, info in sorted(state["batches"].items()):
            batch_id = info.get("batch_id")
            if not batch_id:
                print(f"  ❌ {filename}: ошибка загрузки")
                has_errors = True
                continue

            try:
                batch = client.batches.retrieve(batch_id)
                status = batch.status
                info["status"] = status
                info["output_file_id"] = getattr(batch, "output_file_id", None)
                info["error_file_id"] = getattr(batch, "error_file_id", None)

                counts = batch.request_counts
                total = counts.total if counts else "?"
                completed = counts.completed if counts else "?"
                failed = counts.failed if counts else "?"

                # Status emoji
                emoji = {
                    "completed": "✅",
                    "failed": "❌",
                    "in_progress": "⏳",
                    "validating": "🔍",
                    "finalizing": "📦",
                    "cancelling": "🚫",
                    "cancelled": "🚫",
                    "expired": "⏰",
                }.get(status, "❓")

                progress = f"{completed}/{total}" if total != "?" else ""
                if failed and failed != "?" and int(failed) > 0:
                    progress += f" (failed: {failed})"

                print(f"  {emoji} {filename:20s} {status:15s} {progress}")

                if status not in ("completed", "failed", "cancelled", "expired"):
                    all_done = False
                if status == "failed":
                    has_errors = True

            except Exception as e:
                print(f"  ❌ {filename}: ошибка проверки — {e}")
                has_errors = True

        save_state(state)

        if all_done:
            success = sum(1 for b in state["batches"].values() if b.get("status") == "completed")
            print(f"\n🏁 Все батчи завершены. Успешных: {success}/{len(state['batches'])}")
            if has_errors:
                print("⚠️  Есть ошибки — проверь вывод выше")
            else:
                print("   Следующий шаг: python3 run_openai_batches.py --download")
            return True

        if not poll:
            pending = sum(1 for b in state["batches"].values() if b.get("status") not in ("completed", "failed", "cancelled", "expired"))
            print(f"\n⏳ В процессе: {pending} батчей")
            print(f"   Для автоматического ожидания: python3 run_openai_batches.py --poll")
            return False

        print(f"\n⏳ Ожидание {poll_interval} секунд...")
        time.sleep(poll_interval)


# ============================================================
# DOWNLOAD — скачивание результатов
# ============================================================

def cmd_download():
    """Скачивает результаты завершённых батчей"""
    client = OpenAI()
    state = load_state()
    os.makedirs(RESULTS_DIR, exist_ok=True)

    print(f"📥 Скачивание результатов...\n")

    downloaded = 0
    for filename, info in sorted(state["batches"].items()):
        if info.get("status") != "completed":
            print(f"  ⏩ {filename} — статус: {info.get('status', '?')}, пропуск")
            continue

        output_file_id = info.get("output_file_id")
        if not output_file_id:
            print(f"  ❌ {filename} — нет output_file_id")
            continue

        result_filename = filename.replace(".jsonl", "_results.jsonl")
        result_path = os.path.join(RESULTS_DIR, result_filename)

        # Пропуск уже скачанных
        if os.path.exists(result_path) and info.get("downloaded"):
            print(f"  ⏩ {filename} → {result_filename} (уже скачан)")
            downloaded += 1
            continue

        try:
            print(f"  📥 {filename} → {result_filename}...", end=" ", flush=True)
            content = client.files.content(output_file_id)
            content.write_to_file(result_path)
            info["downloaded"] = True
            info["result_file"] = result_path
            save_state(state)

            # Count results
            count = sum(1 for _ in open(result_path))
            print(f"({count} results) ✅")
            downloaded += 1

        except Exception as e:
            print(f"❌ {e}")

        # Скачивание ошибок, если есть
        error_file_id = info.get("error_file_id")
        if error_file_id:
            try:
                error_path = os.path.join(RESULTS_DIR, filename.replace(".jsonl", "_errors.jsonl"))
                content = client.files.content(error_file_id)
                content.write_to_file(error_path)
                error_count = sum(1 for _ in open(error_path))
                if error_count > 0:
                    print(f"  ⚠️  {error_count} ошибок сохранены в {error_path}")
            except:
                pass

    print(f"\n✅ Скачано: {downloaded} файлов в {RESULTS_DIR}/")
    if downloaded > 0:
        print(f"   Следующий шаг: python3 run_openai_batches.py --merge")


# ============================================================
# MERGE — объединение результатов в итоговый датасет
# ============================================================

def cmd_merge():
    """Мерджит результаты OpenAI обратно в annotated_qa.json"""

    print("🔀 Объединение результатов...\n")

    # 1. Загрузка всех результатов
    result_files = sorted(glob.glob(os.path.join(RESULTS_DIR, "*_results.jsonl")))
    if not result_files:
        print(f"❌ Нет файлов результатов в {RESULTS_DIR}/")
        return

    all_results = {}
    total_parsed = 0
    parse_errors = 0

    for filepath in result_files:
        filename = os.path.basename(filepath)
        with open(filepath) as f:
            for line in f:
                try:
                    item = json.loads(line)
                    custom_id = item["custom_id"]

                    # Извлечь ответ модели
                    response_body = item.get("response", {}).get("body", {})
                    choices = response_body.get("choices", [])
                    if choices:
                        content = choices[0].get("message", {}).get("content", "{}")
                        parsed = json.loads(content)
                        all_results[custom_id] = parsed
                        total_parsed += 1
                except Exception as e:
                    parse_errors += 1

        print(f"  📄 {filename}: обработан")

    print(f"\n  Успешно распарсено: {total_parsed}")
    if parse_errors:
        print(f"  Ошибок парсинга: {parse_errors}")

    # 2. Загрузка исходного датасета
    annotated_path = "annotated_qa.json"
    if not os.path.exists(annotated_path):
        print(f"❌ Не найден {annotated_path}")
        return

    with open(annotated_path) as f:
        all_qa = json.load(f)

    # 3. Мердж
    updated = 0
    for qa in all_qa:
        if qa["intent"] != "OTHER":
            continue

        raw_id = qa["session_id"] + "_" + qa["client_text"][:50]
        custom_id = "qa_" + hashlib.md5(raw_id.encode()).hexdigest()[:12]

        if custom_id in all_results:
            r = all_results[custom_id]
            new_intent = r.get("intent", "OTHER")

            # Валидация интента
            valid_intents = {
                "TRIAL_BOOKING", "BOOKING", "BOOKING_CONFIRM", "PRICING",
                "SCHEDULE", "CANCELLATION", "MAKEUP_CLASS", "AGE_GROUP",
                "LOCATION", "RENEWAL", "PERSONAL_DATA", "RESCHEDULE",
                "FREEZE", "FEEDBACK_POSITIVE", "FEEDBACK_NEGATIVE",
                "GENERAL_QUESTION", "PHOTO_REQUEST", "CONTINUATION",
                "GREETING", "OTHER",
            }
            if new_intent not in valid_intents:
                new_intent = "OTHER"

            qa["intent"] = new_intent
            qa["intent_confidence"] = r.get("confidence", 0)
            qa["classified_by"] = "openai_gpt4o_mini"

            # Мердж сущностей
            new_entities = r.get("entities", {})
            if new_entities and isinstance(new_entities, dict):
                # Убираем пустые значения
                new_entities = {k: v for k, v in new_entities.items() if v}
                qa["entities"].update(new_entities)

            updated += 1

    print(f"\n  Обновлено: {updated} из {sum(1 for q in all_qa if q.get('classified_by') == 'openai_gpt4o_mini' or q['intent'] == 'OTHER')} OTHER пар")

    # 4. Сохранение
    output_path = "annotated_qa_v2.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(all_qa, f, ensure_ascii=False, indent=2)

    # 5. Обновление golden_pairs и few_shot
    update_golden_pairs(all_qa)

    # 6. Статистика
    print(f"\n📊 Итоговое распределение интентов:")
    intents = Counter(qa["intent"] for qa in all_qa)
    for intent, count in intents.most_common():
        pct = count / len(all_qa) * 100
        bar = "█" * int(pct)
        print(f"  {intent:>20}: {count:>5} ({pct:>5.1f}%) {bar}")

    remaining_other = intents.get("OTHER", 0)
    print(f"\n  Осталось OTHER: {remaining_other} ({remaining_other/len(all_qa)*100:.1f}%)")
    print(f"\n✅ Сохранено: {output_path}")


def update_golden_pairs(all_qa):
    """Обновляет golden_pairs и few_shot_examples после мерджа"""
    from collections import defaultdict

    golden_by_intent = defaultdict(list)
    for qa in all_qa:
        if qa.get("quality_score", 0) >= 4.0 and qa["intent"] not in ("GREETING", "OTHER", "CONTINUATION"):
            if len(qa.get("staff_text", "")) >= 30 and len(qa.get("client_text", "")) >= 10:
                golden_by_intent[qa["intent"]].append(qa)

    for intent in golden_by_intent:
        golden_by_intent[intent].sort(key=lambda x: -x.get("quality_score", 0))

    kb_dir = "knowledge_base"
    os.makedirs(kb_dir, exist_ok=True)

    # Golden pairs
    golden_path = os.path.join(kb_dir, "golden_pairs_v2.json")
    with open(golden_path, "w", encoding="utf-8") as f:
        json.dump(dict(golden_by_intent), f, ensure_ascii=False, indent=2)

    total_golden = sum(len(v) for v in golden_by_intent.values())
    print(f"\n  Обновлены golden pairs: {total_golden} пар по {len(golden_by_intent)} интентам")

    # Few-shot (top 5 per intent)
    few_shots = {}
    for intent, pairs in golden_by_intent.items():
        few_shots[intent] = [
            {
                "client": p["client_text"],
                "staff": p["staff_text"],
                "entities": p.get("entities", {}),
                "quality": p.get("quality_score", 0),
            }
            for p in pairs[:5]
        ]

    few_shot_path = os.path.join(kb_dir, "few_shot_examples_v2.json")
    with open(few_shot_path, "w", encoding="utf-8") as f:
        json.dump(few_shots, f, ensure_ascii=False, indent=2)

    print(f"  Обновлены few-shot: топ-5 для {len(few_shots)} интентов")


# ============================================================
# FULL — полный цикл
# ============================================================

def cmd_full():
    """Полный цикл: upload → poll → download → merge"""
    print("🚀 ПОЛНЫЙ ЦИКЛ ОБРАБОТКИ\n")

    # Upload
    cmd_upload()

    # Poll until done
    print("\n" + "=" * 50)
    done = cmd_status(poll=True, poll_interval=30)
    if not done:
        print("❌ Не все батчи завершены")
        return

    # Download
    print("\n" + "=" * 50)
    cmd_download()

    # Merge
    print("\n" + "=" * 50)
    cmd_merge()

    print("\n" + "=" * 50)
    print("🏁 ГОТОВО! Полный цикл завершён.")


# ============================================================
# MAIN
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="OpenAI Batch API — классификация интентов для бота «Про Дети»",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Примеры:
  python3 run_openai_batches.py              # полный цикл (upload → poll → download → merge)
  python3 run_openai_batches.py --upload     # только загрузка
  python3 run_openai_batches.py --status     # проверка статуса
  python3 run_openai_batches.py --poll       # ожидание завершения
  python3 run_openai_batches.py --download   # скачивание результатов
  python3 run_openai_batches.py --merge      # объединение в датасет
        """,
    )
    parser.add_argument("--upload", action="store_true", help="Загрузить файлы и создать батчи")
    parser.add_argument("--status", action="store_true", help="Проверить статус")
    parser.add_argument("--poll", action="store_true", help="Ожидать завершения (проверка каждые 30 сек)")
    parser.add_argument("--download", action="store_true", help="Скачать результаты")
    parser.add_argument("--merge", action="store_true", help="Объединить результаты")

    args = parser.parse_args()

    # Проверка API ключа
    if not os.environ.get("OPENAI_API_KEY"):
        print("❌ Не задан OPENAI_API_KEY")
        print("   export OPENAI_API_KEY=sk-...")
        sys.exit(1)

    # Проверка директорий
    if not os.path.exists(BATCH_DIR):
        print(f"❌ Не найдена папка {BATCH_DIR}/")
        print(f"   Распакуй архив pro_deti_bot_v2.zip и запускай из его корня")
        sys.exit(1)

    if args.upload:
        cmd_upload()
    elif args.status:
        cmd_status()
    elif args.poll:
        cmd_status(poll=True)
    elif args.download:
        cmd_download()
    elif args.merge:
        cmd_merge()
    else:
        # По умолчанию — полный цикл
        cmd_full()


if __name__ == "__main__":
    main()
