#!/usr/bin/env python3
"""Audit ESCO leaf-to-sub-family placements and write a review report."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable


REPO_ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = REPO_ROOT / "data" / "taxonomy-review" / "esco-leaf-subfamily-review.csv"
SUBFAMILY_FAMILY_REVIEW_CSV_PATH = REPO_ROOT / "data" / "taxonomy-review" / "esco-subfamily-family-review.csv"
REPORT_PATH = REPO_ROOT / "audit_report.txt"


def normalize_text(value: str | None) -> str:
    return (value or "").strip().lower()


def contains_any(text: str, phrases: Iterable[str]) -> bool:
    return any(phrase in text for phrase in phrases)


def resolve_node_id(rows: list[dict[str, str]], label: str, field_name: str) -> str:
    target = normalize_text(label)
    for row in rows:
        row_label = normalize_text(row.get(field_name))
        if row_label == target:
            node_id_field = (
                "current_family_node_id" if field_name == "current_family_label" else "current_sub_family_node_id"
            )
            node_id = (row.get(node_id_field) or "").strip()
            if node_id:
                return node_id
    return ""


def current_hierarchy_text(row: dict[str, str]) -> str:
    return (
        f"[Parent: {row['current_parent_label']}] -> "
        f"[Family: {row['current_family_label']}] -> "
        f"[Sub-Family: {row['current_sub_family_label']}]"
    )


def proposed_hierarchy_text(family_label: str, sub_family_label: str) -> str:
    return f"[Family: {family_label}] -> [Sub-Family: {sub_family_label}]"


@dataclass(frozen=True)
class Finding:
    leaf_node_id: str
    leaf_label: str
    proposed_sub_family_node_id: str
    proposed_sub_family_label: str
    proposed_family_node_id: str
    proposed_family_label: str
    reason: str


@dataclass(frozen=True)
class Rule:
    name: str
    matches: Callable[[dict[str, str]], bool]
    proposed_sub_family_label: str
    proposed_family_label: str
    reason: str


@dataclass(frozen=True)
class SubFamilyFamilyOverride:
    sub_family_node_id: str
    sub_family_label: str
    override_family_node_id: str
    override_family_label: str
    reason: str


def build_rules() -> list[Rule]:
    return [
        Rule(
            name="web-design-in-graphic-design",
            matches=lambda row: (
                contains_any(
                    normalize_text(row["leaf_label"]),
                    [
                        "web designer",
                        "website designer",
                        "web developer",
                        "frontend developer",
                        "front-end developer",
                    ],
                )
                and contains_any(
                    normalize_text(row["current_sub_family_label"]),
                    ["graphic and multimedia designers", "graphic designers"],
                )
            ),
            proposed_sub_family_label="Web and multimedia developers",
            proposed_family_label="Software and applications developers and analysts",
            reason="Web design and web development titles belong in the software/web development branch, not graphic design, because the work centers on digital product implementation rather than visual-identity design.",
        ),
        Rule(
            name="database-developer-in-network-family",
            matches=lambda row: normalize_text(row["leaf_label"]) == "database developer",
            proposed_sub_family_label="Software developers",
            proposed_family_label="Software and applications developers and analysts",
            reason="Database development is software engineering work, not database administration or network support.",
        ),
        Rule(
            name="real-estate-in-software",
            matches=lambda row: (
                contains_any(
                    normalize_text(row["leaf_label"]),
                    ["property developer", "real estate developer"],
                )
                and contains_any(
                    normalize_text(row["current_family_label"]),
                    ["software and applications developers and analysts", "software developers"],
                )
            ),
            proposed_sub_family_label="Construction managers",
            proposed_family_label="Manufacturing, mining, construction, and distribution managers",
            reason="Property and real-estate development is a built-environment role, so it should be mapped to construction/property management rather than software development.",
        ),
        Rule(
            name="specialized-analyst-in-generic-admin",
            matches=lambda row: (
                "analyst" in normalize_text(row["leaf_label"])
                and contains_any(
                    normalize_text(row["leaf_label"]),
                    [
                        "clinical data analyst",
                        "health data analyst",
                        "medical data analyst",
                        "finance analyst",
                        "financial analyst",
                        "risk analyst",
                        "credit analyst",
                        "insurance analyst",
                    ],
                )
                and contains_any(
                    normalize_text(row["current_family_label"]),
                    ["administration professionals", "business and administration professionals"],
                )
            ),
            proposed_sub_family_label="Business and administration professionals",
            proposed_family_label="Business and administration professionals",
            reason="Specialized analysts need the specific domain hierarchy that matches the subject matter, not a generic business-administration bucket that hides the true occupational context.",
        ),
    ]


def load_family_overrides() -> dict[str, SubFamilyFamilyOverride]:
    with SUBFAMILY_FAMILY_REVIEW_CSV_PATH.open("r", encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))

    overrides: dict[str, SubFamilyFamilyOverride] = {}
    for row in rows:
        review_action = normalize_text(row.get("review_action"))
        override_family_id = (row.get("override_family_node_id") or "").strip()
        override_family_label = (row.get("override_family_label") or "").strip()
        sub_family_node_id = (row.get("sub_family_node_id") or "").strip()
        sub_family_label = (row.get("sub_family_label") or "").strip()
        if not review_action or not review_action.startswith("move to family_node_id:") or not override_family_id:
            continue
        overrides[sub_family_node_id] = SubFamilyFamilyOverride(
            sub_family_node_id=sub_family_node_id,
            sub_family_label=sub_family_label,
            override_family_node_id=override_family_id,
            override_family_label=override_family_label,
            reason=(row.get("review_note") or "").strip(),
        )
    return overrides


def find_flagged_rows(rows: list[dict[str, str]]) -> list[Finding]:
    rules = build_rules()
    family_overrides = load_family_overrides()
    sub_family_id_cache: dict[str, str] = {}
    family_id_cache: dict[str, str] = {}

    def cached_resolve(label: str, field_name: str) -> str:
        if field_name == "current_sub_family_label":
            cache = sub_family_id_cache
        else:
            cache = family_id_cache
        if label not in cache:
            cache[label] = resolve_node_id(rows, label, field_name)
        return cache[label]

    findings: list[Finding] = []
    for row in rows:
        for rule in rules:
            if not rule.matches(row):
                continue

            findings.append(
                Finding(
                    leaf_node_id=(row["leaf_node_id"] or "").strip(),
                    leaf_label=(row["leaf_label"] or "").strip(),
                    proposed_sub_family_node_id=cached_resolve(rule.proposed_sub_family_label, "current_sub_family_label"),
                    proposed_sub_family_label=rule.proposed_sub_family_label,
                    proposed_family_node_id=cached_resolve(rule.proposed_family_label, "current_family_label"),
                    proposed_family_label=rule.proposed_family_label,
                reason=rule.reason,
            )
            )
            break
        else:
            current_sub_family_node_id = (row["current_sub_family_node_id"] or "").strip()
            family_override = family_overrides.get(current_sub_family_node_id)
            if family_override:
                findings.append(
                    Finding(
                        leaf_node_id=(row["leaf_node_id"] or "").strip(),
                        leaf_label=(row["leaf_label"] or "").strip(),
                        proposed_sub_family_node_id=current_sub_family_node_id,
                        proposed_sub_family_label=(row["current_sub_family_label"] or "").strip(),
                        proposed_family_node_id=family_override.override_family_node_id,
                        proposed_family_label=family_override.override_family_label,
                        reason=family_override.reason
                        or "This sub-family has been reviewed as a better fit under the target family, so leaf rows under it inherit the family correction.",
                    )
                )
    return findings


def render_report(rows: list[dict[str, str]], findings: list[Finding]) -> str:
    lines: list[str] = []
    for finding in findings:
        row = next(row for row in rows if (row["leaf_node_id"] or "").strip() == finding.leaf_node_id)
        lines.extend(
            [
                "=" * 80,
                f"leaf_node_id: {finding.leaf_node_id} | move to sub_family_id: {finding.proposed_sub_family_node_id}",
                f"  - Leaf Node Name  : {finding.leaf_label}",
                f"  - Current Hierarchy: {current_hierarchy_text(row)}",
                f"  - Proposed Hierarchy: {proposed_hierarchy_text(finding.proposed_family_label, finding.proposed_sub_family_label)}",
                f"  - Reason          : {finding.reason}",
                "=" * 80,
                "",
            ]
        )

    total_records = len(rows)
    total_moves = len(findings)
    flagged_rate = (total_moves / total_records * 100.0) if total_records else 0.0
    lines.extend(
        [
            f"Total Records Processed: {total_records}",
            f"Total Proposed Moves: {total_moves}",
            f"Flagged Rate: {flagged_rate:.2f}%",
        ]
    )
    return "\n".join(lines) + "\n"


def load_rows(csv_path: Path) -> list[dict[str, str]]:
    with csv_path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def main() -> None:
    rows = load_rows(CSV_PATH)
    findings = find_flagged_rows(rows)
    report = render_report(rows, findings)
    REPORT_PATH.write_text(report, encoding="utf-8")
    print("Audit complete. Review results saved to audit_report.txt")


if __name__ == "__main__":
    main()
