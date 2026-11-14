"""Read the original workbook without dependencies or writes to it."""
from __future__ import annotations

from collections import Counter
from dataclasses import asdict, dataclass
from hashlib import sha256
from pathlib import Path
import re
import unicodedata
from xml.etree import ElementTree as ET
from zipfile import ZipFile

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", str(value))).casefold()


def parse_number(value: str) -> tuple[str, int, int | None] | None:
    """Keep the collection prefix and sub-number distinct; never match numbers alone."""
    value = normalize_text(value)
    value = re.sub(r"[‐‑‒–—−]", "-", value)
    m = re.fullmatch(r"([^\d]+?)-?(\d+)(?:-(\d+))?", value)
    if not m:
        return None
    prefix = m[1].rstrip("-")
    return prefix, int(m[2]), int(m[3]) if m[3] is not None else None


def canonical_number(value: str) -> str:
    parsed = parse_number(value)
    if parsed is None:
        return normalize_text(value)
    prefix, main, sub = parsed
    return f"{prefix}{main}" + (f"-{sub}" if sub else "")


@dataclass(frozen=True)
class Artifact:
    project_id: str
    source_row: int
    source_record_id: str
    institution: str
    collection_number: str
    title: str

    def to_dict(self) -> dict:
        return {**asdict(self), "normalized_institution": normalize_text(self.institution),
                "normalized_collection_number": canonical_number(self.collection_number)}


def workbook_rows(path: Path):
    with ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            shared = ["".join(n.itertext()) for n in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS)]
        # Follow the workbook relationship, rather than assuming the first file is sheet1.
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        sheets = wb.find("m:sheets", NS)
        sheet = next((s for s in sheets if s.get("name") == "sheet1"), sheets[0])
        rel_id = sheet.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        target = next(n.get("Target") for n in rels if n.get("Id") == rel_id)
        sheet_path = target.lstrip("/") if target.startswith("/") else "xl/" + target
        tree = ET.fromstring(z.read(sheet_path))
        headers = None
        for row in tree.findall("m:sheetData/m:row", NS):
            values = {}
            for cell in row.findall("m:c", NS):
                column = re.sub(r"\d", "", cell.get("r", ""))
                value = cell.findtext("m:v", "", NS)
                if cell.get("t") == "s":
                    value = shared[int(value)] if value else ""
                elif cell.get("t") == "inlineStr":
                    node = cell.find("m:is", NS)
                    value = "".join(node.itertext()) if node is not None else ""
                values[column] = value
            if headers is None:
                headers = values
                required = {"소장기관", "소장품번호", "유물"}
                if not required <= set(headers.values()):
                    raise ValueError("Workbook does not contain the required Korean columns")
                continue
            if any(values.values()):
                yield int(row.get("r")), {headers.get(k, k): v for k, v in values.items()}


def load_artifacts(path: Path) -> tuple[list[Artifact], dict]:
    records = list(workbook_rows(path))
    artifacts = []
    for row_no, row in records:
        institution = row.get("소장기관", "").strip()
        number = row.get("소장품번호", "").strip()
        if not institution or not number:
            raise ValueError(f"Missing institution or collection number at worksheet row {row_no}")
        artifacts.append(Artifact(f"artifact::{institution}::{number}", row_no,
                                  row.get("번호", ""), institution, number, row.get("유물", "")))
    keys = Counter(a.project_id for a in artifacts)
    normalized = Counter((normalize_text(a.institution), canonical_number(a.collection_number)) for a in artifacts)
    report = {
        "workbook_filename": path.name, "workbook_sha256": sha256(path.read_bytes()).hexdigest(),
        "artifact_count": len(artifacts), "institution_count": len(set(a.institution for a in artifacts)),
        "institution_counts": dict(Counter(a.institution for a in artifacts).most_common()),
        "columns": sorted({k for _, row in records for k in row}),
        "project_id_format": "artifact::{소장기관}::{소장품번호}",
        "source_row_id_column": "번호", "institution_column": "소장기관",
        "collection_number_column": "소장품번호", "title_column": "유물",
        "duplicate_project_ids": [k for k, n in keys.items() if n > 1],
        "normalized_key_collisions": [list(k) for k, n in normalized.items() if n > 1],
    }
    return artifacts, report


def sample_artifacts(artifacts: list[Artifact], size: int = 100, seed: str = "7", institution: str = "국립중앙박물관"):
    eligible = [a for a in artifacts if normalize_text(a.institution) == normalize_text(institution)]
    return sorted(eligible, key=lambda a: (sha256((seed + "\0" + a.project_id).encode()).hexdigest(), a.project_id))[:size]
