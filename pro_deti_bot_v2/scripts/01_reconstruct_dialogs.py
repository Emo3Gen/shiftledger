#!/usr/bin/env python3
"""
ЭТАП 1: Реконструкция диалогов из flat-сообщений VK API
=======================================================
Детский центр "Про Дети" — проект Shiftledger

Входные данные:
  - messages_part_aa, messages_part_ab (JSONL, VK API format)
  - conversations.jsonl (метаданные диалогов)

Выход:
  - dialogs.json — все диалоги, сгруппированные по peer_id
  - sessions.json — диалоги, разбитые на сессии (gap > SESSION_GAP)
  - stats_report.json — детальная статистика
  - top_sessions_for_review.json — лучшие сессии для ручной валидации

Что делает:
  1. Загружает все сообщения из обоих файлов
  2. Группирует по peer_id (один peer = один клиент)
  3. Сортирует внутри каждого диалога по timestamp
  4. Разбивает длинные диалоги на "сессии" (перерыв > 4 часов = новая сессия)
  5. Для каждой сессии определяет: кто начал, длина, период
  6. Фильтрует мусорные сессии (пустые, одно сообщение без контекста)
  7. Экспортирует в структурированном формате
"""

import json
import os
import sys
from datetime import datetime, timedelta
from collections import Counter, defaultdict

# ============================================================
# КОНФИГУРАЦИЯ
# ============================================================

SESSION_GAP_HOURS = 4  # перерыв между сессиями
MIN_SESSION_MESSAGES = 2  # минимум сообщений в сессии
COMMUNITY_ID = -205381813  # ID сообщества VK (from_id для исходящих)

INPUT_DIR = "/mnt/user-data/uploads"
OUTPUT_DIR = "/home/claude/shiftledger/output"

MESSAGE_FILES = [
    os.path.join(INPUT_DIR, "messages_part_aa"),
    os.path.join(INPUT_DIR, "messages_part_ab"),
]
CONVERSATIONS_FILE = os.path.join(INPUT_DIR, "conversations.jsonl")


# ============================================================
# ЗАГРУЗКА ДАННЫХ
# ============================================================

def load_messages(filepaths):
    """Загрузка всех сообщений из JSONL-файлов с обработкой кодировки"""
    messages = []
    errors = 0
    for fp in filepaths:
        with open(fp, "rb") as f:
            for line_num, line in enumerate(f):
                try:
                    text = line.decode("utf-8", errors="replace").strip()
                    if text:
                        msg = json.loads(text)
                        messages.append(msg)
                except (json.JSONDecodeError, Exception):
                    errors += 1
    print(f"  Загружено сообщений: {len(messages)}, ошибок парсинга: {errors}")
    return messages


def load_conversations(filepath):
    """Загрузка метаданных диалогов"""
    convos = []
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            try:
                convos.append(json.loads(line.strip()))
            except:
                pass
    print(f"  Загружено метаданных диалогов: {len(convos)}")
    return convos


# ============================================================
# РЕКОНСТРУКЦИЯ ДИАЛОГОВ
# ============================================================

def group_by_peer(messages):
    """Группировка сообщений по peer_id + сортировка по времени"""
    dialogs = defaultdict(list)
    for msg in messages:
        peer_id = msg.get("_peer_id") or msg.get("peer_id")
        if peer_id:
            dialogs[peer_id].append(msg)

    # Сортировка каждого диалога по timestamp
    for peer_id in dialogs:
        dialogs[peer_id].sort(key=lambda m: m.get("date", 0))

    print(f"  Сгруппировано диалогов: {len(dialogs)}")
    return dict(dialogs)


def split_into_sessions(dialog_messages, gap_hours=SESSION_GAP_HOURS):
    """
    Разбивает один диалог на сессии.
    Новая сессия начинается когда перерыв > gap_hours.
    """
    if not dialog_messages:
        return []

    sessions = []
    current_session = [dialog_messages[0]]

    for i in range(1, len(dialog_messages)):
        prev_time = dialog_messages[i - 1].get("date", 0)
        curr_time = dialog_messages[i].get("date", 0)
        gap_seconds = curr_time - prev_time

        if gap_seconds > gap_hours * 3600:
            sessions.append(current_session)
            current_session = [dialog_messages[i]]
        else:
            current_session.append(dialog_messages[i])

    if current_session:
        sessions.append(current_session)

    return sessions


def normalize_message(msg):
    """Нормализация сообщения в чистый формат"""
    is_staff = msg.get("out") == 1
    from_id = msg.get("from_id", 0)

    return {
        "id": msg.get("id"),
        "date": msg.get("date"),
        "datetime": datetime.fromtimestamp(msg.get("date", 0)).isoformat(),
        "role": "staff" if is_staff else "client",
        "from_id": from_id,
        "admin_author_id": msg.get("admin_author_id") if is_staff else None,
        "text": msg.get("text", ""),
        "has_attachments": bool(msg.get("attachments")),
        "attachment_types": [
            a.get("type", "unknown") for a in msg.get("attachments", [])
        ],
        "has_reply": bool(msg.get("reply_message")),
        "reply_text": (msg.get("reply_message") or {}).get("text", ""),
    }


def build_session_metadata(session_msgs, peer_id, session_idx):
    """Строит метаданные сессии"""
    normalized = [normalize_message(m) for m in session_msgs]

    # Кто начал сессию
    initiator = normalized[0]["role"]

    # Подсчёт сообщений по ролям
    client_msgs = [m for m in normalized if m["role"] == "client"]
    staff_msgs = [m for m in normalized if m["role"] == "staff"]

    # Средняя длина текста
    client_texts = [m["text"] for m in client_msgs if m["text"]]
    staff_texts = [m["text"] for m in staff_msgs if m["text"]]

    # Время ответа оператора (первый ответ после сообщения клиента)
    response_times = []
    for i in range(1, len(normalized)):
        if normalized[i]["role"] == "staff" and normalized[i - 1]["role"] == "client":
            rt = normalized[i]["date"] - normalized[i - 1]["date"]
            if 0 < rt < 86400:  # до 24 часов — разумное время ответа
                response_times.append(rt)

    # Определяем операторов в сессии
    operators = set()
    for m in staff_msgs:
        if m.get("admin_author_id"):
            operators.add(m["admin_author_id"])

    return {
        "peer_id": peer_id,
        "session_index": session_idx,
        "session_id": f"{peer_id}_{session_idx}",
        "start_time": normalized[0]["datetime"],
        "end_time": normalized[-1]["datetime"],
        "start_timestamp": normalized[0]["date"],
        "end_timestamp": normalized[-1]["date"],
        "duration_minutes": round(
            (normalized[-1]["date"] - normalized[0]["date"]) / 60, 1
        ),
        "total_messages": len(normalized),
        "client_messages": len(client_msgs),
        "staff_messages": len(staff_msgs),
        "initiator": initiator,
        "operators": list(operators),
        "avg_client_msg_len": (
            round(sum(len(t) for t in client_texts) / len(client_texts), 1)
            if client_texts
            else 0
        ),
        "avg_staff_msg_len": (
            round(sum(len(t) for t in staff_texts) / len(staff_texts), 1)
            if staff_texts
            else 0
        ),
        "avg_response_time_sec": (
            round(sum(response_times) / len(response_times), 1)
            if response_times
            else None
        ),
        "has_attachments": any(m["has_attachments"] for m in normalized),
        "messages": normalized,
    }


# ============================================================
# АНАЛИТИКА
# ============================================================

def compute_statistics(all_sessions):
    """Сводная статистика по всем сессиям"""

    total_sessions = len(all_sessions)
    total_messages = sum(s["total_messages"] for s in all_sessions)

    # Распределение по длине
    length_dist = Counter()
    for s in all_sessions:
        n = s["total_messages"]
        if n <= 2:
            length_dist["1-2"] += 1
        elif n <= 5:
            length_dist["3-5"] += 1
        elif n <= 10:
            length_dist["6-10"] += 1
        elif n <= 20:
            length_dist["11-20"] += 1
        elif n <= 50:
            length_dist["21-50"] += 1
        else:
            length_dist["50+"] += 1

    # Инициатор
    initiator_dist = Counter(s["initiator"] for s in all_sessions)

    # Операторы
    operator_sessions = Counter()
    for s in all_sessions:
        for op in s["operators"]:
            operator_sessions[op] += 1

    # Время ответа
    response_times = [
        s["avg_response_time_sec"]
        for s in all_sessions
        if s["avg_response_time_sec"] is not None
    ]

    # По годам
    year_dist = Counter()
    for s in all_sessions:
        try:
            year = s["start_time"][:4]
            year_dist[year] += 1
        except:
            pass

    # Топ ключевых слов клиентов
    word_freq = Counter()
    keywords = [
        "расписание", "цена", "стоимость", "абонемент", "запись", "записать",
        "пробное", "пробный", "возраст", "лет", "адрес", "отработка",
        "отменить", "перенести", "перенос", "пропуск", "группа",
        "тренер", "педагог", "время", "свободн", "место", "мест",
    ]
    for s in all_sessions:
        for m in s["messages"]:
            if m["role"] == "client":
                text_lower = m["text"].lower()
                for kw in keywords:
                    if kw in text_lower:
                        word_freq[kw] += 1

    return {
        "total_sessions": total_sessions,
        "total_messages": total_messages,
        "avg_messages_per_session": round(total_messages / total_sessions, 1),
        "session_length_distribution": dict(
            sorted(length_dist.items(), key=lambda x: ["1-2","3-5","6-10","11-20","21-50","50+"].index(x[0]))
        ),
        "initiator_distribution": dict(initiator_dist),
        "operator_session_counts": dict(operator_sessions.most_common()),
        "response_time_stats": {
            "count": len(response_times),
            "avg_seconds": round(sum(response_times) / len(response_times), 1) if response_times else None,
            "avg_minutes": round(sum(response_times) / len(response_times) / 60, 1) if response_times else None,
            "median_seconds": round(sorted(response_times)[len(response_times) // 2], 1) if response_times else None,
        },
        "sessions_by_year": dict(sorted(year_dist.items())),
        "top_client_keywords": dict(word_freq.most_common(20)),
    }


def select_top_sessions(all_sessions, n=100):
    """
    Отбирает лучшие сессии для ручной валидации и few-shot примеров.
    Критерии:
    - Минимум 3 сообщения
    - Есть и клиент, и оператор
    - Оба пишут содержательно (не пустые ответы)
    - Приоритет: средняя длина, баланс реплик
    """
    candidates = []
    for s in all_sessions:
        if s["total_messages"] < 3:
            continue
        if s["client_messages"] == 0 or s["staff_messages"] == 0:
            continue
        if s["avg_client_msg_len"] < 10 or s["avg_staff_msg_len"] < 20:
            continue

        # Скоринг: баланс + содержательность
        balance = min(s["client_messages"], s["staff_messages"]) / max(
            s["client_messages"], s["staff_messages"]
        )
        content_score = min(s["avg_staff_msg_len"], 300) / 300  # насыщенность ответов
        length_score = min(s["total_messages"], 20) / 20  # оптимальная длина 10-20

        score = balance * 0.3 + content_score * 0.4 + length_score * 0.3
        candidates.append((score, s))

    candidates.sort(key=lambda x: -x[0])

    top = []
    for score, session in candidates[:n]:
        top.append({
            "session_id": session["session_id"],
            "score": round(score, 3),
            "total_messages": session["total_messages"],
            "client_messages": session["client_messages"],
            "staff_messages": session["staff_messages"],
            "start_time": session["start_time"],
            "preview": " | ".join(
                f"[{m['role']}] {m['text'][:80]}"
                for m in session["messages"][:4]
            ),
            "messages": session["messages"],
        })

    return top


# ============================================================
# MAIN
# ============================================================

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print("\n" + "=" * 70)
    print("ЭТАП 1: РЕКОНСТРУКЦИЯ ДИАЛОГОВ — Детский центр 'Про Дети'")
    print("=" * 70)

    # 1. Загрузка
    print("\n[1/5] Загрузка сообщений...")
    all_messages = load_messages(MESSAGE_FILES)

    print("\n[2/5] Загрузка метаданных диалогов...")
    conversations = load_conversations(CONVERSATIONS_FILE)

    # 2. Группировка по peer_id
    print("\n[3/5] Группировка по peer_id и разбивка на сессии...")
    dialogs = group_by_peer(all_messages)

    # 3. Разбивка на сессии
    all_sessions = []
    sessions_by_peer = {}

    for peer_id, msgs in dialogs.items():
        raw_sessions = split_into_sessions(msgs)
        peer_sessions = []

        for idx, session_msgs in enumerate(raw_sessions):
            if len(session_msgs) < MIN_SESSION_MESSAGES:
                continue
            session = build_session_metadata(session_msgs, peer_id, idx)
            peer_sessions.append(session)
            all_sessions.append(session)

        if peer_sessions:
            sessions_by_peer[str(peer_id)] = {
                "peer_id": peer_id,
                "total_sessions": len(peer_sessions),
                "total_messages": sum(s["total_messages"] for s in peer_sessions),
                "first_contact": peer_sessions[0]["start_time"],
                "last_contact": peer_sessions[-1]["end_time"],
            }

    print(f"  Всего сессий (>= {MIN_SESSION_MESSAGES} сообщений): {len(all_sessions)}")
    print(f"  Уникальных клиентов: {len(sessions_by_peer)}")

    # 4. Аналитика
    print("\n[4/5] Вычисление статистики...")
    stats = compute_statistics(all_sessions)
    stats["unique_clients"] = len(sessions_by_peer)
    stats["data_period"] = {
        "from": all_sessions[0]["start_time"] if all_sessions else None,
        "to": all_sessions[-1]["end_time"] if all_sessions else None,
    }

    # 5. Отбор лучших сессий
    print("\n[5/5] Отбор топ-сессий для review и few-shot...")
    top_sessions = select_top_sessions(all_sessions, n=200)

    # === ЭКСПОРТ ===
    print("\n" + "-" * 70)
    print("ЭКСПОРТ РЕЗУЛЬТАТОВ")
    print("-" * 70)

    # Sessions (без полных сообщений — только метаданные)
    sessions_meta = []
    for s in all_sessions:
        meta = {k: v for k, v in s.items() if k != "messages"}
        meta["message_count"] = len(s["messages"])
        sessions_meta.append(meta)

    with open(os.path.join(OUTPUT_DIR, "sessions_meta.json"), "w", encoding="utf-8") as f:
        json.dump(sessions_meta, f, ensure_ascii=False, indent=2)
    print(f"  sessions_meta.json: {len(sessions_meta)} сессий (метаданные)")

    # Full sessions with messages
    with open(os.path.join(OUTPUT_DIR, "sessions_full.json"), "w", encoding="utf-8") as f:
        json.dump(all_sessions, f, ensure_ascii=False, indent=2)
    print(f"  sessions_full.json: {len(all_sessions)} сессий (с сообщениями)")

    # Top sessions for review
    with open(os.path.join(OUTPUT_DIR, "top_sessions_for_review.json"), "w", encoding="utf-8") as f:
        json.dump(top_sessions, f, ensure_ascii=False, indent=2)
    print(f"  top_sessions_for_review.json: {len(top_sessions)} лучших сессий")

    # Stats report
    with open(os.path.join(OUTPUT_DIR, "stats_report.json"), "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, indent=2)
    print(f"  stats_report.json: сводная статистика")

    # Client profiles
    with open(os.path.join(OUTPUT_DIR, "client_profiles.json"), "w", encoding="utf-8") as f:
        json.dump(sessions_by_peer, f, ensure_ascii=False, indent=2)
    print(f"  client_profiles.json: {len(sessions_by_peer)} клиентов")

    # === PRINT SUMMARY ===
    print("\n" + "=" * 70)
    print("ИТОГОВАЯ СТАТИСТИКА")
    print("=" * 70)
    print(f"  Всего сообщений загружено:    {len(all_messages):,}")
    print(f"  Уникальных клиентов:          {len(sessions_by_peer):,}")
    print(f"  Всего сессий:                 {len(all_sessions):,}")
    print(f"  Среднее сообщений/сессию:     {stats['avg_messages_per_session']}")
    print(f"  Среднее время ответа:         {stats['response_time_stats']['avg_minutes']} мин")
    print(f"  Медианное время ответа:       {round(stats['response_time_stats']['median_seconds']/60, 1)} мин")
    print(f"\n  Распределение по длине сессий:")
    for k, v in stats["session_length_distribution"].items():
        bar = "█" * (v // 20)
        print(f"    {k:>6} сообщений: {v:>5} {bar}")
    print(f"\n  По годам:")
    for year, count in sorted(stats["sessions_by_year"].items()):
        bar = "█" * (count // 30)
        print(f"    {year}: {count:>5} сессий {bar}")
    print(f"\n  Топ ключевых слов клиентов:")
    for kw, count in sorted(stats["top_client_keywords"].items(), key=lambda x: -x[1])[:15]:
        print(f"    {kw:>15}: {count}")
    print(f"\n  Топ-5 лучших сессий для few-shot:")
    for ts in top_sessions[:5]:
        print(f"    [{ts['session_id']}] score={ts['score']} msgs={ts['total_messages']}")
        print(f"      {ts['preview'][:120]}")

    print(f"\n✅ Этап 1 завершён. Результаты в {OUTPUT_DIR}/")
    return stats


if __name__ == "__main__":
    main()
