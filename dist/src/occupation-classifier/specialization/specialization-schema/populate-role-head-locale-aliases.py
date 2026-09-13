#!/usr/bin/env python3

"""
Suggest and optionally apply Romanian and Hungarian role-head aliases.

Install the translator dependency when needed:
  python3 -m venv src/occupation-classifier/specialization/specialization-schema/.venv
  src/occupation-classifier/specialization/specialization-schema/.venv/bin/python -m pip install deep-translator

Then run from the repository root:
  src/occupation-classifier/specialization/specialization-schema/.venv/bin/python \
    src/occupation-classifier/specialization/specialization-schema/populate-role-head-locale-aliases.py

By default this script writes a review CSV only, checkpointing after each
translated row. Pass --apply to also update:
  specialization-role-head-aliases.csv
  specialization-role-head-aliases.ro.csv
  specialization-role-head-aliases.hu.csv
"""

from __future__ import annotations

import argparse
import csv
import sys
import time
from pathlib import Path


SCHEMA_DIR = Path(__file__).resolve().parent
DEFAULT_INPUT = SCHEMA_DIR / "role-heads-missing-ro-hu-aliases.csv"
DEFAULT_OUTPUT = SCHEMA_DIR / "role-heads-populated-locale-aliases.csv"
GLOBAL_ALIAS_PATH = SCHEMA_DIR / "specialization-role-head-aliases.csv"
LOCALE_ALIAS_PATHS = {
    "ro": SCHEMA_DIR / "specialization-role-head-aliases.ro.csv",
    "hu": SCHEMA_DIR / "specialization-role-head-aliases.hu.csv",
}

LOCALES = ("ro", "hu")
APPLY_NOTE = "Google Translate locale migration 2026-09-13: generated role-head alias; review before relying on ambiguous occupations."

# A compact set of locale-specific characters catches many already-reviewed aliases
# that were previously stored in the global role-head alias file.
LOCALE_MARKERS = {
    "ro": set("ăâîșţțĂÂÎȘŢȚ"),
    "hu": set("áéíóöőúüűÁÉÍÓÖŐÚÜŰ"),
}

HEADER = [
    "role_head",
    "global_aliases",
    "current_ro_aliases",
    "current_hu_aliases",
    "missing_locales",
    "ro_aliases_to_add",
    "hu_aliases_to_add",
    "global_aliases_to_move_ro",
    "global_aliases_to_move_hu",
    "global_aliases_to_keep",
    "translator_note",
    "note",
]


def split_aliases(value: str | None) -> list[str]:
    if not value:
        return []
    return [alias.strip() for alias in value.split(";") if alias.strip()]


def normalize(value: str) -> str:
    return value.strip().lower()


def join_aliases(values: list[str]) -> str:
    seen = set()
    unique_values = []
    for value in values:
        normalized = normalize(value)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        unique_values.append(normalized)
    return "; ".join(unique_values)


def locale_for_marked_alias(alias: str) -> str | None:
    matches = [locale for locale, markers in LOCALE_MARKERS.items() if any(char in markers for char in alias)]
    if len(matches) == 1:
        return matches[0]
    return None


def translator_class():
    try:
        from deep_translator import GoogleTranslator
    except ImportError:
        print(
            "Missing dependency: deep-translator. Install with `python3 -m pip install deep-translator`.",
            file=sys.stderr,
        )
        raise SystemExit(2)

    return GoogleTranslator


def translate_role_head(translator_type, locale: str, role_head: str) -> tuple[str, str]:
    last_error = ""
    for attempt in range(1, 4):
        try:
            translated = translator_type(source="en", target=locale).translate(role_head)
        except Exception as exc:  # noqa: BLE001 - keep batch generation moving.
            last_error = str(exc)
            time.sleep(0.5 * attempt)
            continue

        if not translated:
            last_error = "translation empty"
            time.sleep(0.5 * attempt)
            continue

        translated = translated.strip().lower()
        if translated == role_head.strip().lower():
            return "", "translation same as role_head"

        return translated, ""

    return "", f"translation failed after 3 attempts: {last_error}"


def write_review_rows(path: Path, rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as output_file:
        writer = csv.DictWriter(output_file, fieldnames=HEADER)
        writer.writeheader()
        writer.writerows(rows)


def build_row(row: dict[str, str], translator_type) -> dict[str, str]:
    role_head = row["role_head"].strip()
    global_aliases = split_aliases(row.get("global_aliases"))
    current_aliases = {
        "ro": split_aliases(row.get("current_ro_aliases")),
        "hu": split_aliases(row.get("current_hu_aliases")),
    }
    missing_locales = set(split_aliases(row.get("missing_locales")))

    move_aliases = {"ro": [], "hu": []}
    keep_global_aliases = []
    for alias in global_aliases:
        locale = locale_for_marked_alias(alias)
        if locale in move_aliases:
            move_aliases[locale].append(alias)
        else:
            keep_global_aliases.append(alias)

    suggested_aliases = {"ro": [], "hu": []}
    notes = []
    for locale in LOCALES:
        if locale not in missing_locales:
            continue
        suggested_aliases[locale].extend(move_aliases[locale])
        if translator_type is not None:
            translated, note = translate_role_head(translator_type, locale, role_head)
            if translated:
                suggested_aliases[locale].append(translated)
                for alias in global_aliases:
                    if normalize(alias) == normalize(translated):
                        move_aliases[locale].append(alias)
            if note:
                notes.append(f"{locale}: {note}")

    output_row = {name: "" for name in HEADER}
    output_row.update(
        {
            "role_head": role_head,
            "global_aliases": join_aliases(global_aliases),
            "current_ro_aliases": join_aliases(current_aliases["ro"]),
            "current_hu_aliases": join_aliases(current_aliases["hu"]),
            "missing_locales": row.get("missing_locales", ""),
            "ro_aliases_to_add": join_aliases(suggested_aliases["ro"]),
            "hu_aliases_to_add": join_aliases(suggested_aliases["hu"]),
            "global_aliases_to_move_ro": join_aliases(move_aliases["ro"]),
            "global_aliases_to_move_hu": join_aliases(move_aliases["hu"]),
            "global_aliases_to_keep": join_aliases(keep_global_aliases),
            "translator_note": "; ".join(notes),
            "note": row.get("note", ""),
        }
    )
    return output_row


def build_rows(input_path: Path, output_path: Path, use_translator: bool) -> list[dict[str, str]]:
    translator_type = translator_class() if use_translator else None

    with input_path.open(newline="", encoding="utf-8") as input_file:
        reader = csv.DictReader(input_file)
        rows = list(reader)

    existing_rows = read_csv(output_path)
    existing_by_role_head = {
        normalize(row.get("role_head", "")): row
        for row in existing_rows
        if normalize(row.get("role_head", ""))
    }
    output_rows = [
        existing_by_role_head.get(normalize(row["role_head"]), {name: "" for name in HEADER} | {"role_head": row["role_head"]})
        for row in rows
    ]

    for index, row in enumerate(rows, start=1):
        output_rows[index - 1] = build_row(row, translator_type)
        write_review_rows(output_path, output_rows)
        print(f"checkpoint {index}/{len(rows)}: {row['role_head']}", flush=True)

    return output_rows


def needs_translation_retry(row: dict[str, str]) -> bool:
    missing_locales = set(split_aliases(row.get("missing_locales")))
    if "translation failed" in row.get("translator_note", ""):
        return True
    return any(
        locale in missing_locales and not split_aliases(row.get(f"{locale}_aliases_to_add"))
        for locale in LOCALES
    )


def retry_failed_rows(input_path: Path, output_path: Path) -> list[dict[str, str]]:
    translator_type = translator_class()

    with input_path.open(newline="", encoding="utf-8") as input_file:
        source_rows = list(csv.DictReader(input_file))

    output_rows = read_csv(output_path)
    output_by_role_head = {
        normalize(row.get("role_head", "")): row
        for row in output_rows
        if normalize(row.get("role_head", ""))
    }
    merged_rows = [
        output_by_role_head.get(normalize(row["role_head"]), build_row(row, translator_type=None))
        for row in source_rows
    ]

    retry_total = sum(1 for row in merged_rows if needs_translation_retry(row))
    retry_index = 0
    for index, source_row in enumerate(source_rows, start=1):
        existing_row = merged_rows[index - 1]
        if not needs_translation_retry(existing_row):
            continue
        retry_index += 1
        merged_rows[index - 1] = build_row(source_row, translator_type)
        write_review_rows(output_path, merged_rows)
        print(
            f"retry checkpoint {retry_index}/{retry_total} ({index}/{len(source_rows)}): {source_row['role_head']}",
            flush=True,
        )

    return merged_rows


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as input_file:
        return list(csv.DictReader(input_file))


def write_alias_rows(path: Path, rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as output_file:
        writer = csv.DictWriter(output_file, fieldnames=["role_head", "alias", "note"])
        writer.writeheader()
        writer.writerows(
            {
                "role_head": row.get("role_head", ""),
                "alias": row.get("alias", ""),
                "note": row.get("note", ""),
            }
            for row in rows
        )


def row_key(row: dict[str, str]) -> tuple[str, str]:
    return normalize(row["role_head"]), normalize(row["alias"])


def aliases_by_role(rows: list[dict[str, str]]) -> dict[str, list[str]]:
    aliases: dict[str, list[str]] = {}
    for row in rows:
        role_head = normalize(row.get("role_head", ""))
        alias = normalize(row.get("alias", ""))
        if not role_head or not alias:
            continue
        aliases.setdefault(role_head, []).append(alias)
    return aliases


def apply_rows(rows: list[dict[str, str]]) -> None:
    global_rows = read_csv(GLOBAL_ALIAS_PATH)
    global_aliases = aliases_by_role(global_rows)
    remove_global_keys = set()

    locale_rows = {locale: read_csv(path) for locale, path in LOCALE_ALIAS_PATHS.items()}
    locale_keys = {
        locale: {row_key(row) for row in existing_rows}
        for locale, existing_rows in locale_rows.items()
    }
    added_counts = {locale: 0 for locale in LOCALES}

    for row in rows:
        role_head = normalize(row["role_head"])
        for locale in LOCALES:
            aliases_to_add = split_aliases(row.get(f"{locale}_aliases_to_add"))
            aliases_to_move = split_aliases(row.get(f"global_aliases_to_move_{locale}"))
            for alias in aliases_to_add + aliases_to_move:
                alias = normalize(alias)
                if not role_head or not alias or alias == role_head:
                    continue

                key = (role_head, alias)
                if key not in locale_keys[locale]:
                    locale_rows[locale].append(
                        {
                            "role_head": role_head,
                            "alias": alias,
                            "note": APPLY_NOTE,
                        }
                    )
                    locale_keys[locale].add(key)
                    added_counts[locale] += 1

                if alias in global_aliases.get(role_head, []):
                    remove_global_keys.add(key)

    cleaned_global_rows = [
        row
        for row in global_rows
        if row_key(row) not in remove_global_keys
    ]

    write_alias_rows(GLOBAL_ALIAS_PATH, cleaned_global_rows)
    for locale, path in LOCALE_ALIAS_PATHS.items():
        write_alias_rows(path, sorted(locale_rows[locale], key=row_key))

    print(f"Removed {len(remove_global_keys)} migrated aliases from {GLOBAL_ALIAS_PATH.name}.")
    for locale in LOCALES:
        print(f"Added {added_counts[locale]} aliases to {LOCALE_ALIAS_PATHS[locale].name}.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--no-translator",
        action="store_true",
        help="Only classify existing global aliases by locale markers; do not call Google Translator.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Update global and locale role-head alias CSV files from the generated suggestions.",
    )
    parser.add_argument(
        "--apply-existing-output",
        action="store_true",
        help="Skip translation and apply rows already saved in --output.",
    )
    parser.add_argument(
        "--retry-failed-output",
        action="store_true",
        help="Only retry output rows with failed or missing translation suggestions.",
    )
    args = parser.parse_args()

    if args.apply_existing_output:
        with args.output.open(newline="", encoding="utf-8") as output_file:
            rows = list(csv.DictReader(output_file))
    elif args.retry_failed_output:
        rows = retry_failed_rows(args.input, args.output)
    else:
        rows = build_rows(args.input, args.output, use_translator=not args.no_translator)

    print(f"Wrote {len(rows)} review rows to {args.output}")
    if args.apply:
        apply_rows(rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
