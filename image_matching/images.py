"""Only copy images whose API record explicitly permits reuse; export no authenticated URL."""
from __future__ import annotations

from hashlib import sha256
from pathlib import Path
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request

from .api import ALLOWED_HOSTS, APIError, public_url

LICENSES = {
    "1": "공공누리 제1유형 (출처표시)",
    "2": "공공누리 제2유형 (출처표시·상업적 이용금지)",
    "3": "공공누리 제3유형 (출처표시·변경금지)",
    "4": "공공누리 제4유형 (출처표시·상업적 이용금지·변경금지)",
}


def make_thumbnail(image_path: Path, public_dir: Path, width: int = 480) -> dict:
    """Create an atomic WebP derivative without changing the source image."""
    from PIL import Image, ImageOps
    directory = public_dir / "thumbs"
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / (image_path.stem + f"-{width}.webp")
    if target.is_file() and target.stat().st_mtime >= image_path.stat().st_mtime:
        with Image.open(target) as existing:
            if existing.format == "WEBP" and existing.width <= width:
                return {"thumbnail_url": "thumbs/" + target.name, "thumbnail_width": existing.width,
                        "thumbnail_height": existing.height, "thumbnail_bytes": target.stat().st_size}
    with Image.open(image_path) as original:
        image = ImageOps.exif_transpose(original).convert("RGB")
        image.thumbnail((width, 4096), Image.Resampling.LANCZOS)
        temporary = target.with_suffix(".webp.tmp")
        image.save(temporary, format="WEBP", quality=84, method=5)
        temporary.replace(target)
        return {"thumbnail_url": "thumbs/" + target.name, "thumbnail_width": image.width,
                "thumbnail_height": image.height, "thumbnail_bytes": target.stat().st_size}


def image_records(detail: dict, record: dict) -> list[dict]:
    images = detail.get("imageList", [])
    if not images and (record.get("imgUri") or record.get("protected_image_available")):
        return [{"id": record["id"], **{k: v for k, v in record.items() if k.startswith("img")},
                 "protected_image_available": record.get("protected_image_available", False)}]
    return sorted(images, key=lambda x: int(x.get("imgOrder") or 0))


def usage_check(record: dict, image: dict) -> dict:
    record_code = str(record.get("glsv", ""))
    image_code = str(image.get("glsv", ""))
    # The API normally supplies glsv on the collection record, not separately on each image.
    # Preserve that scope explicitly. Never fabricate an image-level license or creator name.
    belongs = image.get("id") == record.get("id")
    code = image_code or record_code if belongs else ""
    allowed = belongs and code == "1" and record_code in {"", "1"}
    return {"code": code, "label": LICENSES.get(code, ""),
            "scope": "image" if image_code else "collection_record",
            "evidence_field": "detail.imageList.glsv" if image_code else "detail.list.glsv",
            "same_collection_record": belongs,
            "download_allowed": allowed,
            "status": "allowed_with_attribution" if allowed else "manual_review_required",
            "policy_url": "https://www.emuseum.go.kr/copyright"}


def copy_image(client, image: dict, usage: dict, output_dir: Path) -> dict:
    result = {"source_image_id": image.get("imgId", ""), "image_order": image.get("imgOrder", ""),
              "public_source_url": public_url(image.get("imgUri", "")), "local_url": "",
              "license": usage, "status": "license_review", "error_code": ""}
    if not usage["download_allowed"]:
        return result
    # Use the API's actual returned URL. Never construct an image API route or invent a URL.
    url = image.get("imgThumUriL") or image.get("imgUri", "")
    if not url:
        result["status"] = "url_refresh_required"
        return result
    parts = urlsplit(url if "://" in url else "https://" + url)
    if parts.hostname not in ALLOWED_HOSTS or parts.username or parts.password:
        result.update(status="image_error", error_code="UNTRUSTED_IMAGE_URL")
        return result
    url = urlunsplit(("https", parts.netloc, parts.path, parts.query, ""))
    identifier = image.get("imgId") or image.get("id")
    stem = sha256(str(identifier).encode()).hexdigest()[:24]
    output_dir.mkdir(parents=True, exist_ok=True)
    existing = [p for p in output_dir.glob(stem + ".*") if p.suffix in {".jpg", ".png", ".webp"}]
    if existing:
        result.update(status="available", local_url="images/" + existing[0].name)
        try:
            result.update(make_thumbnail(existing[0], output_dir.parent))
        except (OSError, ValueError):
            result.update(status="image_error", error_code="THUMBNAIL_DECODE_ERROR")
        return result
    for attempt in range(3):
        client._pace("image")
        try:
            with client.opener.open(Request(url, headers={"Accept": "image/*", "User-Agent": "HeritageImageMatcher/1.0"}), timeout=30) as response:
                raw = response.read(20 * 1024 * 1024 + 1)
                response_type = response.headers.get_content_type()
                final_public = public_url(response.url)
            if len(raw) > 20 * 1024 * 1024:
                raise APIError("IMAGE_TOO_LARGE")
            extension = None
            if raw.startswith(b"\xff\xd8\xff") and response_type in {"image/jpeg", "application/octet-stream"}:
                extension = ".jpg"
            elif raw.startswith(b"\x89PNG\r\n\x1a\n") and response_type in {"image/png", "application/octet-stream"}:
                extension = ".png"
            elif raw.startswith(b"RIFF") and raw[8:12] == b"WEBP" and response_type in {"image/webp", "application/octet-stream"}:
                extension = ".webp"
            if extension is None:
                raise APIError("NOT_AN_IMAGE")
            path = output_dir / (stem + extension)
            temp = path.with_suffix(path.suffix + ".tmp")
            temp.write_bytes(raw)
            temp.replace(path)
            result.update(status="available", local_url="images/" + path.name, bytes=len(raw),
                          sha256=sha256(raw).hexdigest(), content_type=response_type,
                          downloaded_variant="imgThumUriL" if image.get("imgThumUriL") else "imgUri")
            try:
                result.update(make_thumbnail(path, output_dir.parent))
            except (OSError, ValueError):
                result.update(status="image_error", error_code="THUMBNAIL_DECODE_ERROR")
            if final_public:
                result["public_source_url"] = final_public
            return result
        except HTTPError as e:
            code = f"IMAGE_HTTP_{e.code}"
            retry = e.code == 429 or e.code >= 500
            if e.code == 429:
                client.rate_limits += 1
        except (URLError, TimeoutError, ConnectionError):
            code, retry = "IMAGE_NETWORK_ERROR", True
        except APIError as e:
            code, retry = e.code, False
        if not retry or attempt == 2:
            client.failures += 1
            result.update(status="image_error", error_code=code)
            return result
        client.retries += 1
        import time
        time.sleep(2 ** attempt)
    return result
