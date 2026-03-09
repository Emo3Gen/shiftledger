#!/usr/bin/env python3
"""
ЭТАП 3: Автоматическая разметка интентов и скоринг качества
============================================================

Этот скрипт:
1. Берёт QA-пары из этапа 2
2. Создаёт батчи для обработки через Claude API (или выполняет локально)
3. Для каждой QA-пары определяет:
   - intent (классификация)
   - entities (возраст ребёнка, дата, время, группа и т.д.)
   - quality_score (1-5) — насколько хорош ответ оператора
   - is_golden (bool) — подходит ли как few-shot пример
4. Экспортирует размеченный датасет

Режимы работы:
  --mode=local   : Разметка на основе правил (быстро, без API)
  --mode=export  : Экспорт батчей для Claude API
  --mode=merge   : Объединение результатов после API

Для MVP начинаем с rule-based разметки, потом уточняем через LLM.
"""

import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime

OUTPUT_DIR = "/home/claude/shiftledger/output"
KB_DIR = "/home/claude/shiftledger/knowledge_base"

# ============================================================
# INTENT TAXONOMY — адаптировано для детского центра
# ============================================================

INTENT_TAXONOMY = {
    "TRIAL_BOOKING": {
        "description": "Запись на пробное занятие",
        "keywords": ["пробное", "пробный", "пробного", "первое занятие", "попробовать", "ознакомительн"],
        "priority": 1,
    },
    "BOOKING": {
        "description": "Запись на занятие / проверка наличия мест",
        "keywords": ["записать", "записаться", "запись", "свободн", "мест ", "место ", "есть ли мест"],
        "priority": 2,
    },
    "PRICING": {
        "description": "Вопросы о ценах, абонементах, оплате",
        "keywords": ["цена", "стоимость", "абонемент", "сколько стоит", "прайс", "оплат", "стоит"],
        "priority": 3,
    },
    "SCHEDULE": {
        "description": "Расписание, время занятий",
        "keywords": ["расписание", "во сколько", "в какое время", "когда занятия", "график", "расписани"],
        "priority": 4,
    },
    "CANCELLATION": {
        "description": "Отмена, пропуск занятия",
        "keywords": ["отменить", "не придем", "не сможем", "не будет", "пропуск", "пропустим",
                      "не придёт", "заболел", "болеем", "больничн", "не получится"],
        "priority": 5,
    },
    "MAKEUP_CLASS": {
        "description": "Отработка пропущенного занятия, перенос",
        "keywords": ["отработк", "перенос", "перенести", "отработать", "можно ли отработать"],
        "priority": 6,
    },
    "AGE_GROUP": {
        "description": "Вопросы о возрасте, группах, направлениях",
        "keywords": ["возраст", " лет", "года ребен", "месяц", "группа мини", "мини-",
                      "какие занятия", "какие группы", "направлени"],
        "priority": 7,
    },
    "LOCATION": {
        "description": "Адрес, как добраться, какой центр",
        "keywords": ["адрес", "где находит", "как добрат", "проехать", "на ломоносов",
                      "на морском", "какой филиал", "какой центр"],
        "priority": 8,
    },
    "RENEWAL": {
        "description": "Продление абонемента, переход в новый месяц",
        "keywords": ["продлить", "продлен", "новый абонемент", "на следующий месяц",
                      "заканчивается абонемент", "абонемент истек"],
        "priority": 9,
    },
    "FEEDBACK_POSITIVE": {
        "description": "Благодарность, положительный отзыв",
        "keywords": ["спасибо", "понрави", "благодар", "отлично", "замечательно", "очень довольн"],
        "priority": 10,
    },
    "FEEDBACK_NEGATIVE": {
        "description": "Жалоба, недовольство",
        "keywords": ["недовольн", "жалоб", "не понрави", "плохо", "разочарован", "претензи"],
        "priority": 11,
    },
    "GREETING": {
        "description": "Приветствие без конкретного запроса",
        "keywords": [],  # handled separately
        "priority": 99,
    },
    "OTHER": {
        "description": "Прочее / не классифицировано",
        "keywords": [],
        "priority": 100,
    },
}


# ============================================================
# ENTITY EXTRACTION (rule-based)
# ============================================================

def extract_entities(text):
    """Извлекает сущности из текста клиента"""
    entities = {}
    text_lower = text.lower()

    # Возраст ребёнка
    age_patterns = [
        r'(\d+)\s*(?:лет|год|года)',
        r'(\d+)\s*(?:мес|месяц)',
        r'ребенку\s*(\d+)',
        r'ребёнку\s*(\d+)',
        r'дочке?\s*(\d+)',
        r'сыну?\s*(\d+)',
    ]
    for pattern in age_patterns:
        match = re.search(pattern, text_lower)
        if match:
            age_val = int(match.group(1))
            if "мес" in text_lower[match.start():match.end() + 10]:
                entities["child_age_months"] = age_val
            else:
                entities["child_age_years"] = age_val
            break

    # Дата
    date_patterns = [
        r'(\d{1,2})\s*(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)',
        r'(\d{1,2})[./](\d{1,2})',
        r'(завтра|послезавтра|сегодня)',
        r'(понедельник|вторник|сред[уы]|четверг|пятниц[уы]|суббот[уы]|воскресень[ея])',
    ]
    for pattern in date_patterns:
        match = re.search(pattern, text_lower)
        if match:
            entities["date_reference"] = match.group(0)
            break

    # Время
    time_match = re.search(r'(\d{1,2})[:\.](\d{2})', text)
    if time_match:
        entities["time"] = f"{time_match.group(1)}:{time_match.group(2)}"
    elif re.search(r'в\s+(\d{1,2})\s', text_lower):
        m = re.search(r'в\s+(\d{1,2})\s', text_lower)
        entities["time"] = f"{m.group(1)}:00"

    # Имя ребёнка (после "дочь/сын/ребёнок" + имя)
    name_patterns = [
        r'(?:дочь|дочка|дочку|сын|сына|ребенок|ребёнок|зовут)\s+([А-Я][а-яё]+)',
    ]
    for pattern in name_patterns:
        match = re.search(pattern, text)
        if match:
            entities["child_name"] = match.group(1)
            break

    # Группа / направление
    group_patterns = [
        r'(мини[- ]?\d?)',
        r'(логопед)',
        r'(подготовк[уа] к школе)',
        r'(творчеств)',
        r'(музык)',
        r'(танц)',
        r'(развивающ)',
    ]
    for pattern in group_patterns:
        match = re.search(pattern, text_lower)
        if match:
            entities["group_type"] = match.group(1)
            break

    return entities


# ============================================================
# INTENT CLASSIFICATION (rule-based with priority)
# ============================================================

def classify_intent(client_text):
    """Классификация интента по правилам с приоритетами"""
    text_lower = client_text.lower().strip()

    # Special case: pure greeting
    if re.match(r'^(здравствуйте|добрый день|добрый вечер|доброе утро|привет|hello|hi)[!.?\s]*$', text_lower):
        return "GREETING"

    # Check all intents by priority
    matches = []
    for intent_name, config in INTENT_TAXONOMY.items():
        if not config["keywords"]:
            continue
        for kw in config["keywords"]:
            if kw in text_lower:
                matches.append((config["priority"], intent_name))
                break

    if matches:
        matches.sort(key=lambda x: x[0])
        return matches[0][1]

    return "OTHER"


# ============================================================
# QUALITY SCORING (rule-based)
# ============================================================

def score_quality(client_text, staff_text, intent):
    """
    Оценка качества ответа оператора (1-5):
    5 = Идеальный ответ для few-shot
    4 = Хороший, полный ответ
    3 = Нормальный, но неполный
    2 = Слабый ответ
    1 = Плохой / неинформативный
    """
    score = 3  # baseline

    staff_lower = staff_text.lower()

    # Positive signals
    if len(staff_text) > 50:
        score += 0.5
    if len(staff_text) > 100:
        score += 0.3

    # Contains name (personalized)
    if re.search(r'^[А-Я][а-яё]+,\s', staff_text):
        score += 0.3

    # Contains greeting
    if any(g in staff_lower for g in ["здравствуйте", "добрый день", "доброе утро"]):
        score += 0.2

    # Contains emoji (customer-friendly)
    if re.search(r'[\U0001F300-\U0001FAFF]', staff_text):
        score += 0.2

    # Contains specific info (numbers, times, addresses)
    if re.search(r'\d{1,2}[:.]\d{2}', staff_text):  # time
        score += 0.3
    if re.search(r'\d+\s*(?:руб|₽|р\.)', staff_text):  # price
        score += 0.3

    # Negative signals
    if len(staff_text) < 20:
        score -= 1.0
    if staff_text.strip() in ["Ок", "Да", "Хорошо", "Понял", "Ладно", "👌", "✅"]:
        score -= 1.5
    if "к сожалению" in staff_lower and len(staff_text) < 40:
        score -= 0.3

    # Intent-specific scoring
    if intent in ["PRICING", "SCHEDULE", "AGE_GROUP"] and len(staff_text) < 30:
        score -= 0.5  # info questions need substance

    return round(min(max(score, 1.0), 5.0), 1)


# ============================================================
# GOLDEN PAIR SELECTION
# ============================================================

def is_golden_pair(qa, score):
    """Определяет, подходит ли пара как эталонный few-shot пример"""
    if score < 4.0:
        return False
    if qa["intent"] in ["GREETING", "OTHER"]:
        return False
    if len(qa["staff_text"]) < 30:
        return False
    if len(qa["client_text"]) < 10:
        return False
    # Staff response should be substantive
    if qa["staff_text"].strip() in ["Ок", "Да", "Хорошо", "✅", "👌"]:
        return False
    return True


# ============================================================
# MAIN PIPELINE
# ============================================================

def main():
    print("\n" + "=" * 70)
    print("ЭТАП 3: АВТОМАТИЧЕСКАЯ РАЗМЕТКА ИНТЕНТОВ И СКОРИНГ")
    print("=" * 70)

    # Load QA pairs
    print("\n[1/4] Загрузка QA-пар...")
    with open(os.path.join(OUTPUT_DIR, "qa_pairs.json"), "r", encoding="utf-8") as f:
        qa_pairs = json.load(f)
    print(f"  Загружено: {len(qa_pairs)} QA-пар")

    # Classify and score
    print("\n[2/4] Классификация интентов и скоринг...")
    annotated = []
    intent_counter = Counter()
    quality_dist = Counter()
    golden_count = 0
    entity_count = 0

    for qa in qa_pairs:
        # Intent
        intent = classify_intent(qa["client_text"])
        # Entities
        entities = extract_entities(qa["client_text"])
        # Quality
        quality = score_quality(qa["client_text"], qa["staff_text"], intent)
        # Golden
        golden = is_golden_pair(qa, quality)

        annotated_qa = {
            **qa,
            "intent": intent,
            "entities": entities,
            "quality_score": quality,
            "is_golden": golden,
        }
        annotated.append(annotated_qa)

        intent_counter[intent] += 1
        quality_dist[round(quality)] += 1
        if golden:
            golden_count += 1
        if entities:
            entity_count += 1

    print(f"  Размечено: {len(annotated)} пар")
    print(f"  Золотых пар: {golden_count}")
    print(f"  Пар с сущностями: {entity_count}")

    # Stats
    print("\n[3/4] Статистика разметки...")
    print(f"\n  Распределение интентов:")
    for intent, count in intent_counter.most_common():
        pct = count / len(annotated) * 100
        bar = "█" * int(pct)
        print(f"    {intent:>20}: {count:>5} ({pct:>5.1f}%) {bar}")

    print(f"\n  Распределение качества:")
    for score in sorted(quality_dist.keys()):
        count = quality_dist[score]
        pct = count / len(annotated) * 100
        bar = "█" * int(pct / 2)
        stars = "⭐" * score
        print(f"    {stars}: {count:>5} ({pct:>5.1f}%) {bar}")

    # Export
    print("\n[4/4] Экспорт размеченных данных...")

    # Full annotated dataset
    with open(os.path.join(OUTPUT_DIR, "annotated_qa.json"), "w", encoding="utf-8") as f:
        json.dump(annotated, f, ensure_ascii=False, indent=2)
    print(f"  annotated_qa.json: {len(annotated)} размеченных пар")

    # Golden pairs grouped by intent
    golden_by_intent = defaultdict(list)
    for qa in annotated:
        if qa["is_golden"]:
            golden_by_intent[qa["intent"]].append(qa)

    # Sort each intent's golden pairs by quality
    for intent in golden_by_intent:
        golden_by_intent[intent].sort(key=lambda x: -x["quality_score"])

    with open(os.path.join(KB_DIR, "golden_pairs.json"), "w", encoding="utf-8") as f:
        json.dump(dict(golden_by_intent), f, ensure_ascii=False, indent=2)
    print(f"  golden_pairs.json: {golden_count} золотых пар по {len(golden_by_intent)} интентам")

    # Few-shot file (top 5 per intent, formatted for prompts)
    few_shots = {}
    for intent, pairs in golden_by_intent.items():
        few_shots[intent] = []
        for p in pairs[:5]:
            few_shots[intent].append({
                "client": p["client_text"],
                "staff": p["staff_text"],
                "entities": p["entities"],
                "quality": p["quality_score"],
            })

    with open(os.path.join(KB_DIR, "few_shot_examples.json"), "w", encoding="utf-8") as f:
        json.dump(few_shots, f, ensure_ascii=False, indent=2)
    print(f"  few_shot_examples.json: топ-5 примеров для {len(few_shots)} интентов")

    # Entity statistics
    entity_stats = defaultdict(Counter)
    for qa in annotated:
        for k, v in qa["entities"].items():
            entity_stats[k][str(v)] += 1

    with open(os.path.join(OUTPUT_DIR, "entity_stats.json"), "w", encoding="utf-8") as f:
        json.dump({k: dict(v.most_common(20)) for k, v in entity_stats.items()}, f, ensure_ascii=False, indent=2)
    print(f"  entity_stats.json: статистика по сущностям")

    # === Claude API Batch Export ===
    # For future LLM-based annotation refinement
    export_claude_batches(annotated)

    print(f"\n✅ Этап 3 завершён.")
    print(f"   Золотые пары готовы для few-shot: {KB_DIR}/few_shot_examples.json")
    print(f"   Размеченный датасет: {OUTPUT_DIR}/annotated_qa.json")


def export_claude_batches(annotated, batch_size=50):
    """
    Экспортирует батчи для уточнения через Claude API.
    Полезно для:
    - Верификации rule-based разметки
    - Классификации неопределённых (OTHER) интентов
    - Улучшения скоринга качества
    """
    batch_dir = os.path.join(OUTPUT_DIR, "claude_batches")
    os.makedirs(batch_dir, exist_ok=True)

    # Focus on OTHER and borderline cases
    to_verify = [qa for qa in annotated if qa["intent"] == "OTHER" or qa["quality_score"] == 3.0]
    total_batches = (len(to_verify) + batch_size - 1) // batch_size

    system_prompt = """Ты — эксперт по классификации обращений в детский центр развития.

Для каждой пары "вопрос клиента → ответ оператора" определи:

1. intent — один из:
   TRIAL_BOOKING, BOOKING, PRICING, SCHEDULE, CANCELLATION,
   MAKEUP_CLASS, AGE_GROUP, LOCATION, RENEWAL, FEEDBACK_POSITIVE,
   FEEDBACK_NEGATIVE, GREETING, OTHER

2. quality_score (1-5):
   5 = Идеальный, персонализированный, полный ответ
   4 = Хороший, содержательный ответ
   3 = Приемлемый, но можно улучшить
   2 = Слабый, неполный
   1 = Плохой, неинформативный

3. entities — извлечённые сущности (child_age, date, time, group_type, child_name)

Ответь строго в JSON формате."""

    for batch_idx in range(min(total_batches, 5)):  # First 5 batches as sample
        batch = to_verify[batch_idx * batch_size:(batch_idx + 1) * batch_size]
        batch_data = {
            "batch_id": f"verify_{batch_idx:03d}",
            "system_prompt": system_prompt,
            "items": [
                {
                    "id": f"{qa['session_id']}",
                    "client_text": qa["client_text"][:500],
                    "staff_text": qa["staff_text"][:500],
                    "current_intent": qa["intent"],
                    "current_score": qa["quality_score"],
                }
                for qa in batch
            ],
        }

        filepath = os.path.join(batch_dir, f"batch_{batch_idx:03d}.json")
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(batch_data, f, ensure_ascii=False, indent=2)

    print(f"  claude_batches/: {min(total_batches, 5)} батчей для верификации через Claude API")
    print(f"    ({len(to_verify)} пар требуют уточнения, из них {sum(1 for qa in annotated if qa['intent'] == 'OTHER')} — OTHER)")


if __name__ == "__main__":
    main()
