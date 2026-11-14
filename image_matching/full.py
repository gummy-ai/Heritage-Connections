"""Durable full NMK matching worker. Launch with systemd-run --user, not a terminal job."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime
import csv
import fcntl
import json
import os
from pathlib import Path
import runpy
import signal
import sqlite3
import threading
import time

from .api import APIError, load_env, sanitize, write_json
from .data import Artifact, load_artifacts, workbook_rows
from .images import make_thumbnail
from .matching import candidate_identity, choose_candidate, search_candidates
from .quota import DailyQuotaReached, DurableClient, KST, QuotaLedger, next_reset, today

ROOT = Path(__file__).resolve().parents[1]
PRIVATE = ROOT / "image_matching/.private"
OUTPUT = ROOT / "image_matching/results/full-nmk"
PUBLIC = ROOT / "image_matching/public"
WORKBOOK = ROOT.parent / "online-learning/2026-09-05/input/203703_131741.xlsx"
STOP = threading.Event()


def stamp():
    return datetime.now(KST).isoformat()


def available_photo_ids():
    known = set()
    collection_path = ROOT / "assets/collection.json"
    if collection_path.exists():
        for item in json.loads(collection_path.read_text()).get("artifacts", []):
            if item.get("image") and (ROOT / item["image"]).is_file():
                known.add(item["headKey"])
    legacy_path = ROOT / "assets/legacy-images.json"
    if legacy_path.exists():
        for item in json.loads(legacy_path.read_text()):
            if item.get("webPath") and (ROOT / item["webPath"]).is_file():
                known.add(f"artifact::{item.get('institution') or item.get('credit')}::{item['id']}")
    return known


def connect_state():
    PRIVATE.mkdir(parents=True, exist_ok=True)
    os.chmod(PRIVATE, 0o700)
    db = sqlite3.connect(PRIVATE / "full-nmk.sqlite3", timeout=30)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    db.execute("CREATE TABLE IF NOT EXISTS items (project_id TEXT PRIMARY KEY, ordinal INTEGER, priority INTEGER, artifact TEXT, status TEXT NOT NULL DEFAULT 'pending', result TEXT, attempts INTEGER NOT NULL DEFAULT 0, retry_at REAL NOT NULL DEFAULT 0)")
    db.execute("CREATE INDEX IF NOT EXISTS work_order ON items(status,priority,ordinal)")
    db.commit()
    return db


def initialize(db, workbook):
    artifacts, analysis = load_artifacts(workbook)
    old = db.execute("SELECT value FROM meta WHERE key='workbook_sha256'").fetchone()
    if old and old[0] != analysis["workbook_sha256"]:
        raise APIError("SOURCE_WORKBOOK_CHANGED", fatal=True)
    if db.execute("SELECT COUNT(*) FROM items").fetchone()[0]:
        return json.loads(db.execute("SELECT value FROM meta WHERE key='plan'").fetchone()[0])
    targets = [a for a in artifacts if a.institution == "국립중앙박물관"]
    catalog = json.loads((ROOT / "assets/recommendations.json").read_text())["catalog"]
    catalog_ids = [item.get("headKey") or f"artifact::{item['institution']}::{item['id']}" for item in catalog.values()]
    known = available_photo_ids()
    missing = [key for key in catalog_ids if key not in known]
    priority_position = {key: index for index, key in enumerate(missing)}
    other_catalog = {key: index for index, key in enumerate(catalog_ids)}
    targets.sort(key=lambda a: (0 if a.project_id in priority_position else 1 if a.project_id in other_catalog else 2,
                                priority_position.get(a.project_id, other_catalog.get(a.project_id, a.source_row))))
    for i, a in enumerate(targets):
        priority = 0 if a.project_id in priority_position else 1 if a.project_id in other_catalog else 2
        db.execute("INSERT INTO items(project_id,ordinal,priority,artifact) VALUES(?,?,?,?)", (a.project_id, i, priority, json.dumps(a.to_dict(), ensure_ascii=False)))
    imported = 0
    pilot = ROOT / "image_matching/results/pilot-100/matches.json"
    if pilot.exists():
        for record in json.loads(pilot.read_text()):
            if record["institution"] != "국립중앙박물관":
                continue
            if record["image_status"] == "available":
                path = PUBLIC / record["representative_image_url"]
                if not path.is_file():
                    continue
                record.update(make_thumbnail(path, PUBLIC))
            db.execute("UPDATE items SET status='done',result=?,attempts=1 WHERE project_id=?", (json.dumps(record, ensure_ascii=False), record["project_id"]))
            imported += 1
    plan = {"created_at": stamp(), "target_institution": "국립중앙박물관", "total_targets": len(targets),
            "source_workbook_sha256": analysis["workbook_sha256"], "recommendation_catalog_count": len(catalog),
            "priority_missing_photo_count": len(missing), "priority_project_ids": missing,
            "catalog_project_ids": catalog_ids, "imported_pilot_records": imported,
            "order": "missing recommendation photos; remaining catalog artifacts; remaining NMK artifacts",
            "source_workbook_modified": False}
    for key, value in [("workbook_sha256", analysis["workbook_sha256"]), ("plan", json.dumps(plan, ensure_ascii=False))]:
        db.execute("INSERT OR REPLACE INTO meta VALUES(?,?)", (key, value))
    db.commit()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    write_json(OUTPUT / "plan.json", plan)
    return plan


def prior_usage_estimates():
    # The portal has no documented remaining-quota query. Count observable local history plus reserve.
    counts = {"list": 20, "detail": 20, "code": 20, "image": 20}
    for path in (PRIVATE / "cache").glob("*.json"):
        if datetime.fromtimestamp(path.stat().st_mtime, KST).date().isoformat() != today():
            continue
        try:
            data = json.loads(path.read_text())
            operation = "detail" if "imageList" in data else "code" if any("code" in row for row in data.get("list", [])) else "list"
            counts[operation] += 1
        except (ValueError, OSError):
            continue
    for path in (PUBLIC / "images").glob("*"):
        if path.is_file() and datetime.fromtimestamp(path.stat().st_mtime, KST).date().isoformat() == today():
            counts["image"] += 1
    return counts


def records(db):
    return [json.loads(row[0]) for row in db.execute("SELECT result FROM items WHERE result IS NOT NULL ORDER BY ordinal")]


def publish(db, plan, client, rows, phase="running", next_resume=None):
    items = records(db)
    write_json(OUTPUT / "matches.json", items)
    fields = ["project_id", "institution", "collection_number", "title", "emuseum_id", "match_status", "match_reason", "image_status", "representative_image_url", "thumbnail_url", "error_code"]
    csv_path = OUTPUT / "matches.csv"
    temporary = csv_path.with_suffix(".csv.tmp")
    with temporary.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows({key: item.get(key, "") for key in fields} for item in items)
    temporary.replace(csv_path)
    counts = Counter(item["match_status"] for item in items)
    matched = [item for item in items if item["match_status"].startswith("matched_")]
    available = [item for item in matched if item["image_status"] == "available"]
    public_path = PUBLIC / "artifact-images.json"
    public = json.loads(public_path.read_text()) if public_path.exists() else {"schemaVersion": 1, "artifacts": {}}
    for item in available:
        entry = {key: item[key] for key in ["project_id", "institution", "collection_number", "title", "emuseum_id", "official_detail_page_url", "representative_image_url", "credit", "license"]}
        if item.get("thumbnail_url"):
            entry["thumb"] = item["thumbnail_url"]
        public["artifacts"][item["project_id"]] = {**public["artifacts"].get(item["project_id"], {}), **entry}
    public["generatedAt"] = stamp()
    write_json(public_path, public)
    builder = runpy.run_path(str(ROOT / "scripts/build_site_data.py"))["build"]
    site_count = builder(WORKBOOK, OUTPUT / "matches.json", rows=rows, quiet=True)
    known = available_photo_ids()
    priority = [item for item in items if item["project_id"] in set(plan["priority_project_ids"])]
    done = db.execute("SELECT COUNT(*) FROM items WHERE status='done'").fetchone()[0]
    image_files = [p for p in (PUBLIC / "images").glob("*") if p.is_file() and p.suffix in {".jpg", ".png", ".webp"}]
    thumbs = [p for p in (PUBLIC / "thumbs").glob("*.webp") if p.is_file()]
    needs_review = [item for item in items if item["match_status"] == "manual_review" or item["image_status"] in {"license_review", "image_error", "url_refresh_required"}]
    write_json(OUTPUT / "needs-review.json", needs_review)
    write_json(OUTPUT / "unmatched.json", [item for item in items if item["match_status"] == "not_found"])
    image_bytes = sum(p.stat().st_size for p in image_files)
    thumb_bytes = sum(p.stat().st_size for p in thumbs)
    status = {"updated_at": stamp(), "phase": phase, "total_targets": plan["total_targets"],
              "finished_records": done, "attempted_records": len(items), "remaining_records": plan["total_targets"] - done,
              "matching_count": len(matched), "unmatched_count": counts["not_found"], "review_needed_count": len(needs_review),
              "exact_matches": counts["matched_exact"], "normalized_matches": counts["matched_normalized"],
              "api_error_records": counts["api_error"], "images_available": len(available),
              "image_error_records": sum(item["image_status"] == "image_error" for item in items),
              "image_files": len(image_files), "thumbnail_files": len(thumbs), "image_bytes": image_bytes,
              "thumbnail_bytes": thumb_bytes, "total_image_bytes": image_bytes + thumb_bytes,
              "total_image_mib": round((image_bytes + thumb_bytes) / 1024 ** 2, 2), "collection_count": site_count,
              "priority_total": plan["priority_missing_photo_count"],
              "priority_finished": db.execute("SELECT COUNT(*) FROM items WHERE priority=0 AND status='done'").fetchone()[0],
              "priority_images_available": sum(item["image_status"] == "available" for item in priority),
              "recommendation_photos_available": sum(key in known for key in plan["catalog_project_ids"]),
              "recommendation_catalog_count": plan["recommendation_catalog_count"],
              "recommendation_photos_missing": [key for key in plan["catalog_project_ids"] if key not in known],
              "next_resume_at": datetime.fromtimestamp(next_resume, KST).isoformat() if next_resume else None,
              "api": client.stats() if client else {}, "checkpoint": "image_matching/.private/full-nmk.sqlite3",
              "scope": "image_matching/, scripts/build_site_data.py, assets/collection.json only"}
    write_json(OUTPUT / "status.json", status)
    write_json(OUTPUT / "report.json", status)
    if phase == "complete":
        write_json(OUTPUT / "final-report.json", status)
    return status


def process(client, artifact):
    from .__main__ import public_record
    candidates, truncated = search_candidates(client, artifact)
    decision = choose_candidate(artifact, candidates, truncated=truncated)
    detail = None
    if decision["status"].startswith("matched_"):
        official_id = decision["record"]["id"]
        detail = client.get("detail", {"id": official_id})
        if any(not item.get("imgUri") for item in detail.get("imageList", [])) or any(item.get("protected_image_available") for item in detail["list"]):
            detail = client.get("detail", {"id": official_id}, refresh=True)
        if len(detail["list"]) != 1 or detail["list"][0].get("id") != official_id or not candidate_identity(artifact, detail["list"][0]):
            decision = {"status": "manual_review", "reason": "detail_identity_conflict", "candidates": detail["list"]}
    return public_record(artifact, decision, detail, client, PUBLIC)


def run(workbook=WORKBOOK, env_path=ROOT / ".env", prepare_only=False):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    PRIVATE.mkdir(parents=True, exist_ok=True)
    lock = (PRIVATE / "full-nmk.lock").open("a")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print("A full NMK worker is already running.", flush=True)
        return 2
    db = connect_state()
    plan = initialize(db, workbook)
    rows = {(row.get("소장기관"), row.get("소장품번호")): row for _, row in workbook_rows(workbook)}
    if prepare_only:
        status = publish(db, plan, None, rows, phase="prepared")
        print(json.dumps({k: status[k] for k in ["total_targets", "priority_total", "images_available", "thumbnail_files", "collection_count"]}, ensure_ascii=False), flush=True)
        return 0
    config = json.loads((OUTPUT / "run-config.json").read_text())
    limits = config["daily_limits"]
    if any(not isinstance(value, int) or value < 1 for value in limits.values()) or not {"code", "list", "detail", "image"} <= set(limits):
        raise APIError("INVALID_CONFIRMED_DAILY_LIMITS", fatal=True)
    env = load_env(env_path)
    ledger = QuotaLedger(PRIVATE / "daily-quota.sqlite3", limits, prior_usage_estimates())
    client = DurableClient(env, PRIVATE, ledger)
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: STOP.set())
    publish(db, plan, client, rows)
    print(f"Started NMK worker: {plan['total_targets']} targets; {plan['priority_missing_photo_count']} missing recommendation photos first.", flush=True)
    since_export = 0
    last_export = time.monotonic()
    last_priority = None
    while not STOP.is_set():
        item = db.execute("SELECT project_id,artifact,attempts,priority FROM items WHERE status IN ('pending','retry') AND retry_at<=? ORDER BY priority,ordinal LIMIT 1", (time.time(),)).fetchone()
        if item is None:
            pending = db.execute("SELECT MIN(retry_at) FROM items WHERE status IN ('pending','retry')").fetchone()[0]
            if pending is None:
                status = publish(db, plan, client, rows, phase="complete")
                print(json.dumps({k: status[k] for k in ["phase", "matching_count", "unmatched_count", "review_needed_count", "images_available", "total_image_bytes"]}, ensure_ascii=False), flush=True)
                return 0
            publish(db, plan, client, rows, phase="waiting_retry", next_resume=pending)
            STOP.wait(min(30, max(1, pending - time.time())))
            continue
        project_id, raw_artifact, attempts, priority = item
        fields = json.loads(raw_artifact)
        artifact = Artifact(**{k: fields[k] for k in Artifact.__dataclass_fields__})
        try:
            result = process(client, artifact)
        except DailyQuotaReached as e:
            status = publish(db, plan, client, rows, phase="waiting_daily_quota", next_resume=e.retry_at)
            print(f"Daily {e.operation} budget reached; resume at {status['next_resume_at']}.", flush=True)
            while time.time() < e.retry_at and not STOP.is_set():
                STOP.wait(min(30, e.retry_at - time.time()))
            continue
        except APIError as e:
            if e.code in {"22", "3005", "4022"}:
                ledger.exhaust(client.last_operation)
                resume = next_reset()
                publish(db, plan, client, rows, phase="waiting_provider_daily_quota", next_resume=resume)
                print(f"Provider daily limit reached for {client.last_operation}; safely waiting until next KST day.", flush=True)
                while time.time() < resume and not STOP.is_set():
                    STOP.wait(min(30, resume - time.time()))
                continue
            if e.fatal:
                publish(db, plan, client, rows, phase="needs_attention")
                print("Stopped for API/configuration error: " + e.code, flush=True)
                return 2
            from .__main__ import public_record
            result = public_record(artifact, {"status": "api_error", "reason": e.code}, None, client, PUBLIC)
            result["error_code"] = e.code
        attempts += 1
        retry = (result["match_status"] == "api_error" or result["image_status"] in {"image_error", "url_refresh_required"}) and attempts < 3
        safe = sanitize(result, client.key)
        db.execute("UPDATE items SET status=?,result=?,attempts=?,retry_at=? WHERE project_id=?", ("retry" if retry else "done", json.dumps(safe, ensure_ascii=False), attempts, time.time() + 300 if retry else 0, project_id))
        db.commit()
        since_export += 1
        if since_export >= 25 or time.monotonic() - last_export >= 60 or last_priority != priority:
            status = publish(db, plan, client, rows)
            print(f"Progress {status['finished_records']}/{status['total_targets']}; photos {status['images_available']}; priority {status['priority_finished']}/{status['priority_total']}.", flush=True)
            since_export, last_export = 0, time.monotonic()
        last_priority = priority
    publish(db, plan, client, rows, phase="stopped")
    print("Stopped cleanly; checkpoint and public data saved.", flush=True)
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepare", action="store_true")
    args = parser.parse_args()
    try:
        raise SystemExit(run(prepare_only=args.prepare))
    except Exception as e:
        # Systemd journals must never contain request URLs, raw responses, or credential-bearing tracebacks.
        print("Worker stopped safely: " + (e.code if isinstance(e, APIError) else type(e).__name__), flush=True)
        raise SystemExit(2)
