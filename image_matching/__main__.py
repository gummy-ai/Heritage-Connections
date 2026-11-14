from __future__ import annotations

import argparse
from collections import Counter
import csv
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import sys

from .api import APIError, BASE_URL, Client, load_env, public_url, sanitize, write_json
from .data import load_artifacts, sample_artifacts
from .images import copy_image, image_records, usage_check
from .matching import candidate_identity, choose_candidate, search_candidates

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_WORKBOOK = ROOT.parent / "online-learning/2026-09-05/input/203703_131741.xlsx"


def now():
    return datetime.now(timezone.utc).isoformat()


def protection_snapshot(workbook: Path) -> dict:
    reference = ROOT.parent / "heritage-project-site"
    files = [workbook]
    for relative in ("dist/index.html", "dist/app.js", "dist/styles.css", "dist/assets/images/images.json"):
        path = reference / relative
        if path.exists():
            files.append(path)
    files.extend(sorted((reference / "dist/assets/images").glob("*.webp")))
    original = ROOT.parent / "online-learning/2026-09-05"
    for relative in ("src/recommend.py", "src/importance.py", "utils/preprocess.py", "models/kgat.py"):
        path = original / relative
        if path.exists():
            files.append(path)
    return {str(p): sha256(p.read_bytes()).hexdigest() for p in files}


def public_record(artifact, decision: dict, detail: dict | None, client, public_dir: Path) -> dict:
    result = {**artifact.to_dict(), "match_status": decision["status"], "match_reason": decision["reason"],
              "match_confidence": decision.get("confidence"),
              "confidence_kind": decision.get("confidence_kind", ""),
              "title_verification": decision.get("title_verification", {}),
              "emuseum_id": "", "official_title": "", "official_institution_code": "",
              "official_collection_number": "", "official_detail_page_url": "",
              "representative_image_url": "", "public_source_image_url": "", "additional_images": [],
              "credit": "", "license": {}, "image_status": "not_matched", "error_code": "",
              "api_source": BASE_URL + "/detail", "checked_at": now()}
    if not decision["status"].startswith("matched_"):
        result["candidate_ids"] = sorted({r.get("id", "") for r in decision.get("candidates", [])})
        return result
    record = detail["list"][0]
    from .matching import official_number
    result.update(emuseum_id=record["id"], official_title=record.get("nameKr", ""),
                  official_institution_code=record.get("museumCode2", ""),
                  official_collection_number=official_number(record), credit=record.get("museumName2", ""))
    # The API does not provide a public detail-page URL. Leave it empty, rather than inventing it.
    for field in ("detailUrl", "detailUri"):
        if field in record:
            result["official_detail_page_url"] = public_url(record[field])
    images = image_records(detail, record)
    result["api_public_image_count"] = len(images)
    result["credentialed_image_url_present"] = any(bool(r.get("imgUri")) and not public_url(r["imgUri"]) for r in images)
    if not images:
        result["image_status"] = "no_public_image"
        return result
    for image in images:
        result["additional_images"].append({"source_image_id": image.get("imgId", ""),
                                             "image_order": image.get("imgOrder", ""),
                                             "public_source_url": public_url(image.get("imgUri", "")),
                                             "license": usage_check(record, image)})
    first = images[0]
    usage = usage_check(record, first)
    copied = copy_image(client, first, usage, public_dir / "images")
    result.update(representative_image_url=copied.get("local_url", ""),
                  public_source_image_url=copied.get("public_source_url", ""),
                  license=usage, image_status=copied["status"], error_code=copied.get("error_code", ""),
                  representative_selection="lowest_imgOrder_in_verified_public_image_list",
                  downloaded_image_metadata={k: v for k, v in copied.items() if k not in {"license", "local_url"}})
    if copied.get("thumbnail_url"):
        result.update({k: copied[k] for k in ("thumbnail_url", "thumbnail_width", "thumbnail_height", "thumbnail_bytes")})
    return result


def export_results(output: Path, sample: list, completed: dict, client, sample_hash: str, before: dict, workbook: Path, public_dir: Path):
    records = [completed[a.project_id] for a in sample if a.project_id in completed]
    write_json(output / "matches.json", records)
    fields = ["project_id", "institution", "collection_number", "title", "emuseum_id", "official_title",
              "official_institution_code", "official_collection_number", "match_status", "match_confidence",
              "image_status", "representative_image_url", "public_source_image_url", "official_detail_page_url", "credit", "error_code"]
    with (output / "matches.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for record in records:
            writer.writerow({k: record.get(k, "") for k in fields})
    matched = [r for r in records if r["match_status"].startswith("matched_")]
    with_images = [r for r in matched if r["image_status"] == "available"]
    status = Counter(r["match_status"] for r in records)
    manual = [r for r in records if r["match_status"] == "manual_review"]
    report = {
        "generated_at": now(), "planned_sample_size": len(sample), "processed": len(records),
        "complete": len(records) == len(sample), "sample_sha256": sample_hash,
        "matching_exact_raw_number": status["matched_exact"],
        "matching_verified_normalized_number": status["matched_normalized"],
        "matching_verified_total": len(matched), "estimated_or_name_only_matches": 0,
        "matched_records_with_api_images": sum(bool(r.get("api_public_image_count")) for r in matched),
        "images_secured_and_verified_bytes": len(with_images),
        "image_acquisition_rate_of_planned_sample": len(with_images) / len(sample) if sample else 0,
        "image_acquisition_rate_of_matched": len(with_images) / len(matched) if matched else 0,
        "matching_not_found": status["not_found"], "manual_review": len(manual),
        "api_error_records": status["api_error"],
        "license_counts": dict(Counter(r.get("license", {}).get("code", "") or "unknown" for r in matched)),
        "license_scope_counts": dict(Counter(r.get("license", {}).get("scope", "") or "unknown" for r in matched)),
        "license_review_required": sum(r.get("license", {}).get("status") == "manual_review_required" for r in matched),
        "api": client.stats(), "source_files_unchanged": protection_snapshot(workbook) == before,
        "image_url_examples": [{"project_id": r["project_id"], "image_url": r["representative_image_url"],
                                "public_source_url": r["public_source_image_url"], "license": r["license"]} for r in with_images[:5]],
        "notes": [
            "Exact and normalized matches require institution and complete collection number; names never establish identity.",
            "Confidence is rule strength, not a measured probability. No fuzzy/estimated matches are accepted.",
            "The API exposes glsv on collection records; image-level glsv is not invented. License scope is retained per image.",
            "Only type-1 images tied to the same record are copied; other or missing licenses require review.",
            "Image URLs containing serviceKey are never published, cached, or logged. Public JSON references local copies.",
            "image_url_examples are real relative URLs under image_matching/public, not claims of deployed GitHub URLs.",
            "Missing API fields, including official detail-page URLs, remain blank.",
        ],
    }
    write_json(output / "report.json", report)
    write_json(output / "needs-review.json", [r for r in records if not r["match_status"].startswith("matched_") or r["image_status"] != "available"])
    public_records = {}
    for record in with_images:
        public_records[record["project_id"]] = {k: record[k] for k in ["project_id", "institution", "collection_number", "title", "emuseum_id",
                                                                     "official_detail_page_url", "representative_image_url", "credit", "license"]}
    write_json(public_dir / "artifact-images.json", {"schemaVersion": 1, "generatedAt": now(), "artifacts": public_records})
    return report


def main():
    parser = argparse.ArgumentParser(description="기관·소장품번호 기반 e뮤지엄 이미지 매칭 (100점 시범 조회)")
    parser.add_argument("command", choices=["analyze", "probe", "pilot", "full"])
    parser.add_argument("--workbook", type=Path, default=DEFAULT_WORKBOOK)
    parser.add_argument("--env", type=Path, default=ROOT / ".env")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--seed", default="7")
    parser.add_argument("--output", type=Path, default=ROOT / "image_matching/results/pilot-100")
    parser.add_argument("--retry-errors", action="store_true")
    parser.add_argument("--retry-unmatched", action="store_true", help="Explicitly recheck only unmatched/manual-review records")
    args = parser.parse_args()
    if args.command == "full":
        from .full import run
        return run(workbook=args.workbook, env_path=args.env)
    if not 1 <= args.limit <= 100:
        parser.error("현재 실행 범위는 1~100점입니다. 전체 실행은 사용자 승인 후 별도로 확장해야 합니다.")
    output, private = args.output.resolve(), ROOT / "image_matching/.private"
    public_dir = ROOT / "image_matching/public"
    output.mkdir(parents=True, exist_ok=True)
    artifacts, analysis = load_artifacts(args.workbook)
    write_json(output / "workbook-analysis.json", analysis)
    sample = sample_artifacts(artifacts, args.limit, args.seed)
    sample_payload = {"method": "sha256(seed + NUL + project_id) ascending", "seed": args.seed,
                      "workbook_sha256": analysis["workbook_sha256"], "items": [a.to_dict() for a in sample]}
    sample_hash = sha256(json.dumps(sample_payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    write_json(output / "sample.json", {**sample_payload, "sample_sha256": sample_hash})
    if args.command == "analyze":
        print(json.dumps({"artifacts": len(artifacts), "national_museum": analysis["institution_counts"].get("국립중앙박물관"),
                          "sample": len(sample), "sample_sha256": sample_hash}, ensure_ascii=False))
        return 0
    client = Client(load_env(args.env), private)
    if args.command == "probe":
        code = client.get("code", {"parentCode": "PS01", "numOfRows": 100, "pageNo": 1})
        listing = client.get("list", {"museumCode": "PS01001001", "numOfRows": 1, "pageNo": 1})
        if not listing["list"]:
            raise APIError("PROBE_NO_RECORDS", fatal=True)
        detail = client.get("detail", {"id": listing["list"][0]["id"]})
        result = {"endpoint": BASE_URL, "verified_at": now(), "operations": {"code": True, "list": True, "detail": True},
                  "xml_record_shape": "result/list/data/item[@key,@value]", "detail_sections": list(detail),
                  "image_list_available": "imageList" in detail, "license_field": "glsv", "api": client.stats()}
        write_json(output / "endpoint-verification.json", result)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    checkpoint = private / ("pilot-" + sample_hash + ".json")
    state = json.loads(checkpoint.read_text()) if checkpoint.exists() else {"sample_sha256": sample_hash, "completed": {}, "runs": [],
                                                                         "protected_sources_before": protection_snapshot(args.workbook)}
    if state["sample_sha256"] != sample_hash:
        raise ValueError("Checkpoint sample does not match")
    completed, before = state["completed"], state["protected_sources_before"]
    failed = False
    try:
        for i, artifact in enumerate(sample, 1):
            if artifact.project_id in completed:
                status = completed[artifact.project_id]["match_status"]
                if not ((args.retry_errors and status == "api_error") or
                        (args.retry_unmatched and status in {"not_found", "manual_review"})):
                    continue
            try:
                candidates, truncated = search_candidates(client, artifact)
                decision = choose_candidate(artifact, candidates, truncated=truncated)
                detail = None
                if decision["status"].startswith("matched_"):
                    detail = client.get("detail", {"id": decision["record"]["id"]})
                    # Cached responses deliberately contain no credentialed image URLs. Refresh only when needed.
                    if any(not r.get("imgUri") for r in detail.get("imageList", [])) or any(r.get("protected_image_available") for r in detail["list"]):
                        detail = client.get("detail", {"id": decision["record"]["id"]}, refresh=True)
                    if len(detail["list"]) != 1 or not candidate_identity(artifact, detail["list"][0]) or detail["list"][0]["id"] != decision["record"]["id"]:
                        decision = {"status": "manual_review", "reason": "detail_identity_conflict", "candidates": detail["list"]}
                result = public_record(artifact, decision, detail, client, public_dir)
            except APIError as e:
                result = public_record(artifact, {"status": "api_error", "reason": e.code}, None, client, public_dir)
                result["error_code"] = e.code
                if e.fatal:
                    failed = True
            completed[artifact.project_id] = sanitize(result, client.key)
            write_json(checkpoint, state, private=True)
            print(f"{i}/{len(sample)} {artifact.collection_number}: {result['match_status']} / {result['image_status']}", flush=True)
            export_results(output, sample, completed, client, sample_hash, before, args.workbook, public_dir)
            if failed:
                break
    except KeyboardInterrupt:
        failed = True
        print("Interrupted; checkpoint saved. Re-run the same command to resume.", file=sys.stderr)
    state["runs"].append({"at": now(), **client.stats()})
    write_json(checkpoint, state, private=True)
    report = export_results(output, sample, completed, client, sample_hash, before, args.workbook, public_dir)
    report["all_runs_api"] = state["runs"]
    report["api"]["current_run"] = client.stats()
    for field in ("requests", "cache_hits", "retries", "http_rate_limits", "errors"):
        report["api"][field] = sum(run[field] for run in state["runs"])
    diagnostics = output / "unmatched-diagnostics.json"
    if diagnostics.exists():
        report["separate_unmatched_diagnostic_api"] = json.loads(diagnostics.read_text())["api"]
    write_json(output / "report.json", report)
    print(json.dumps({k: report[k] for k in ["processed", "complete", "matching_verified_total", "images_secured_and_verified_bytes",
                                            "manual_review", "matching_not_found", "api_error_records", "source_files_unchanged"]}, ensure_ascii=False))
    return 1 if failed or not report["source_files_unchanged"] else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (APIError, ValueError, OSError) as e:
        # Do not print exception URLs, HTTP bodies, environment data, or tracebacks that could expose credentials.
        message = str(e) if isinstance(e, (APIError, ValueError)) else type(e).__name__
        print("Stopped: " + message, file=sys.stderr)
        raise SystemExit(1)
