"""Conservative institution + collection-number matching; titles never establish identity."""
from __future__ import annotations

from difflib import SequenceMatcher
import re

from .data import Artifact, canonical_number, normalize_text, parse_number

# Confirmed both in the official API guide and a live response. Extend only with verified codes.
INSTITUTIONS = {"국립중앙박물관": "PS01001001"}


def official_number(record: dict) -> str:
    prefix, main, sub = record.get("museumName3", ""), record.get("relicNo", ""), record.get("relicSubNo", "")
    if not prefix or not re.fullmatch(r"\d+", str(main)) or (sub and not re.fullmatch(r"\d+", str(sub))):
        return ""
    return prefix + str(main) + ("-" + str(int(sub)) if sub and int(sub) else "")


def title_evidence(original: str, candidate: dict) -> dict:
    def cleaned(s):
        return re.sub(r"[^\w]", "", normalize_text(s))
    original = cleaned(original)
    names = [cleaned(candidate.get(k, "")) for k in ("nameKr", "name", "nameCn")]
    exact = bool(original and original in names)
    overlap = bool(original and any(n and (original in n or n in original) for n in names))
    return {"exact": exact, "substring": overlap,
            "similarity": round(max((SequenceMatcher(None, original, n).ratio() for n in names if n), default=0), 4),
            "used_as_identity": False}


def candidate_identity(artifact: Artifact, record: dict) -> str:
    if normalize_text(record.get("museumName2", "")) != normalize_text(artifact.institution):
        return ""
    code = INSTITUTIONS.get(artifact.institution)
    if code and record.get("museumCode2") != code:
        return ""
    number = official_number(record)
    if not number or canonical_number(number) != canonical_number(artifact.collection_number):
        return ""
    return "exact" if artifact.collection_number == number else "normalized"


def choose_candidate(artifact: Artifact, candidates: list[dict], *, truncated: bool = False) -> dict:
    unique = {r.get("id"): r for r in candidates if r.get("id")}
    matches = [(candidate_identity(artifact, record), record) for record in unique.values()]
    matches = [(kind, record) for kind, record in matches if kind]
    if truncated:
        return {"status": "manual_review", "reason": "candidate_search_truncated", "candidates": list(unique.values())}
    if len(matches) > 1:
        return {"status": "manual_review", "reason": "multiple_number_matches", "candidates": [r for _, r in matches]}
    if not matches:
        number_conflicts = [r for r in unique.values() if official_number(r) and
                            canonical_number(official_number(r)) == canonical_number(artifact.collection_number)]
        if number_conflicts:
            return {"status": "manual_review", "reason": "institution_conflict_on_collection_number",
                    "candidates": number_conflicts}
        return {"status": "not_found", "reason": "no_institution_and_number_match", "candidates": list(unique.values())}
    kind, record = matches[0]
    return {"status": "matched_" + kind, "reason": "institution_and_collection_number",
            "record": record, "confidence": 1.0 if kind == "exact" else 0.99,
            "confidence_kind": "rule_strength_not_statistical_probability",
            "title_verification": title_evidence(artifact.title, record), "candidates": []}


def search_candidates(client, artifact: Artifact, max_candidates: int = 1000) -> tuple[list[dict], bool]:
    institution_code = INSTITUTIONS.get(artifact.institution)
    if not institution_code:
        return [], True  # institution onboarding requires verified official code, not a guessed alias
    collected = {}
    queries = [{"indexWord": artifact.collection_number}]
    normalized = canonical_number(artifact.collection_number)
    if normalized != artifact.collection_number:
        queries.append({"indexWord": normalized})
    if artifact.title:
        queries.append({"name": artifact.title})
    for query in queries:
        page = 1
        while True:
            response = client.get("list", {"museumCode": institution_code, **query, "numOfRows": 100, "pageNo": page})
            rows = response["list"]
            collected.update({r["id"]: r for r in rows if r.get("id")})
            total = response["totalCount"]
            if total > max_candidates:
                return list(collected.values()), True
            if page * 100 >= total:
                break
            if not rows:
                return list(collected.values()), True
            page += 1
        decision = choose_candidate(artifact, list(collected.values()))
        if decision["status"].startswith("matched_") or decision["status"] == "manual_review":
            return list(collected.values()), False
    # Diagnose a possible source-institution error without ever automatically reassigning the artifact.
    response = client.get("list", {"indexWord": artifact.collection_number, "numOfRows": 100, "pageNo": 1})
    collected.update({r["id"]: r for r in response["list"] if r.get("id")})
    return list(collected.values()), response["totalCount"] > 100
