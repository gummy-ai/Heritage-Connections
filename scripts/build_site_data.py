"""Rebuild the public collection after an approved image-matching run; no API or credentials."""
from argparse import ArgumentParser
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from image_matching.data import workbook_rows
from image_matching.api import write_json


def clean(value):
    text = str(value or "").strip()
    return "" if text.casefold() in {"[]", "{}", "none", "null", "nan"} else text


def build(workbook, matches, *, rows=None, quiet=False):
    if rows is None:
        rows = {(row.get("소장기관"), row.get("소장품번호")): row for _, row in workbook_rows(workbook)}
    path = ROOT / "assets/collection.json"
    existing = json.loads(path.read_text()) if path.exists() else {"schemaVersion": 1, "count": 0, "artifacts": []}
    # Preserve existing item order, unknown fields, and root metadata used by the other designer.
    catalog = {item["headKey"]: item for item in existing.get("artifacts", [])}
    for item in json.loads(matches.read_text()):
        if item["image_status"] != "available":
            continue
        row = rows.get((item["institution"], item["collection_number"]), {})
        fields = {"era": "시대", "material": "재질 1", "materialDetail": "재질 2", "pattern": "문양", "classification": "유물분류 2", "kind": "유물분류 4"}
        data = {"id": item["collection_number"], "headKey": item["project_id"],
                        "name": item["title"].strip(), "officialName": item["official_title"], "institution": item["institution"],
                        "image": "image_matching/public/" + item["representative_image_url"],
                        "emuseumId": item["emuseum_id"], "sourceUrl": item["official_detail_page_url"],
                        "credit": item["credit"], "license": item["license"],
                        **{key: clean(row.get(column)) for key, column in fields.items()}}
        if item.get("thumbnail_url"):
            data["thumb"] = "image_matching/public/" + item["thumbnail_url"]
        previous = catalog.get(item["project_id"], {})
        catalog[item["project_id"]] = {**previous, **{k: v for k, v in data.items() if v or k not in previous}}
    path.parent.mkdir(exist_ok=True)
    write_json(path, {**existing, "count": len(catalog), "artifacts": list(catalog.values())})
    if not quiet:
        print(f"Public collection updated: {len(catalog)} artifacts. No API calls or original-file changes.")
    return len(catalog)


if __name__ == "__main__":
    parser = ArgumentParser()
    parser.add_argument("--workbook", type=Path, default=ROOT.parent / "online-learning/2026-09-05/input/203703_131741.xlsx")
    parser.add_argument("--matches", type=Path, default=ROOT / "image_matching/results/pilot-100/matches.json")
    args = parser.parse_args()
    build(args.workbook, args.matches)
