#!/usr/bin/env python3
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
    print(f"\nResults:")
    for intent, count in intents.most_common():
        print(f"  {intent}: {count}")

    print(f"\nSaved to {outpath}")


if __name__ == "__main__":
    main()
