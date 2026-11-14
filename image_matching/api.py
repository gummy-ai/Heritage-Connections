"""Verified XML API transport; credentials never enter cache, reports, or errors."""
from __future__ import annotations

from hashlib import sha256
from pathlib import Path
import json
import os
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, quote, unquote, urlencode, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from xml.etree import ElementTree as ET

BASE_URL = "https://apis.data.go.kr/1371027/openapi"
ALLOWED_HOSTS = {"apis.data.go.kr", "www.emuseum.go.kr", "emuseum.go.kr", "www.museum.go.kr", "museum.go.kr"}
SECRET_NAMES = {"servicekey", "apikey", "api_key", "token", "access_token", "authorization"}
SUCCESS = {"0000", "00", "0"}
FATAL_CODES = {"3001", "3002", "3003", "3004", "3005", "22", "30", "31", "32", "4022", "4030", "4031", "4032"}


class APIError(RuntimeError):
    def __init__(self, code: str, *, fatal: bool = False):
        self.code, self.fatal = code, fatal
        super().__init__(f"e뮤지엄 request failed: {code}")


def public_url(value: str) -> str:
    """Return only an HTTPS URL with no credential query; never publish a broken redacted URL."""
    if not value:
        return ""
    if value.startswith("www.emuseum.go.kr/"):
        value = "https://" + value
    if value.startswith("/"):
        value = "https://www.emuseum.go.kr" + value
    u = urlsplit(value)
    if u.scheme not in {"https", "http"} or u.hostname not in ALLOWED_HOSTS or u.username or u.password:
        return ""
    if any(k.casefold() in SECRET_NAMES for k, _ in parse_qsl(u.query)):
        return ""
    return urlunsplit(("https", u.netloc, u.path, u.query, ""))


def sanitize(value, secret: str = ""):
    if isinstance(value, dict):
        return {k: sanitize(v, secret) for k, v in value.items() if k.casefold() not in SECRET_NAMES and k != "params"}
    if isinstance(value, list):
        return [sanitize(v, secret) for v in value]
    if isinstance(value, str):
        if secret:
            value = value.replace(secret, "[REDACTED]").replace(quote(secret, safe=""), "[REDACTED]")
        if re.search(r"(?i)servicekey(?:=|%3d)", value):
            # A credential-bearing image URL cannot become a public URL just by redaction.
            return ""
        return value
    return value


def load_env(path: Path) -> dict:
    env = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if "=" not in line:
            raise ValueError("Invalid .env assignment (contents hidden)")
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip("\"'")
    if env.get("EMUSEUM_BASE_URL", BASE_URL).rstrip("/") != BASE_URL:
        raise ValueError("Only the verified official HTTPS API endpoint is allowed")
    if not env.get("EMUSEUM_SERVICE_KEY"):
        raise ValueError("EMUSEUM_SERVICE_KEY is empty; enter it in .env and save")
    env["EMUSEUM_SERVICE_KEY"] = unquote(env["EMUSEUM_SERVICE_KEY"])
    return env


def parse_xml(raw: bytes) -> dict:
    if len(raw) > 20 * 1024 * 1024 or b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
        raise APIError("UNSAFE_OR_OVERSIZED_XML", fatal=True)
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        raise APIError("INVALID_XML") from None
    # Verified 2026-11-14: <result><list><data><item key='...' value='...'/></data>.
    code = root.findtext("resultCode")
    if code is None:
        gateway = root.findtext(".//returnReasonCode") or root.findtext(".//resultCode")
        raise APIError(gateway or "UNRECOGNIZED_XML_ENVELOPE", fatal=True)
    if code not in SUCCESS:
        raise APIError(code, fatal=code in FATAL_CODES)

    def records(node):
        if node is None:
            return []
        result = []
        for data in node.findall("data"):
            result.append({n.get("key"): n.get("value", "") for n in data.findall("item") if n.get("key")})
        return result

    result = {"resultCode": code, "totalCount": int(root.findtext("totalCount", "0")),
              "list": records(root.find("list"))}
    for name in ("imageList", "relationList"):
        section = root.find(name)
        if section is not None:
            nested = section.find("list")
            result[name] = records(nested if nested is not None else section)
    if result["totalCount"] and not result["list"]:
        raise APIError("UNRECOGNIZED_RECORD_SHAPE", fatal=True)
    return result


class OfficialRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        u = urlsplit(newurl)
        if u.hostname not in ALLOWED_HOSTS:
            raise APIError("UNTRUSTED_REDIRECT", fatal=True)
        if u.scheme != "https":
            raise APIError("INSECURE_REDIRECT", fatal=True)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class Client:
    def __init__(self, env: dict, private_dir: Path):
        self.key = env["EMUSEUM_SERVICE_KEY"]
        self.interval = max(0.5, float(env.get("EMUSEUM_REQUEST_INTERVAL", "0.5")))
        self.budget = min(10000, int(env.get("EMUSEUM_MAX_REQUESTS", "1000")))
        self.cache_dir = private_dir / "cache"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        os.chmod(private_dir, 0o700)
        self.calls = self.cache_hits = self.retries = self.rate_limits = self.failures = 0
        self.last_request = 0.0
        self.opener = build_opener(OfficialRedirects())

    def _pace(self, operation: str = "request"):
        if self.calls >= self.budget:
            raise APIError("LOCAL_REQUEST_BUDGET", fatal=True)
        time.sleep(max(0.0, self.interval - (time.monotonic() - self.last_request)))
        self.last_request = time.monotonic()
        self.calls += 1

    def get(self, operation: str, params: dict, *, refresh: bool = False) -> dict:
        if operation not in {"code", "list", "detail"}:
            raise ValueError("Operation not documented in the official API")
        cache_key = sha256(json.dumps([BASE_URL, operation, params], sort_keys=True).encode()).hexdigest()
        cache_path = self.cache_dir / (cache_key + ".json")
        if cache_path.exists() and not refresh:
            self.cache_hits += 1
            return json.loads(cache_path.read_text())
        for attempt in range(3):
            self._pace(operation)
            url = BASE_URL + "/" + operation + "?" + urlencode({"serviceKey": self.key, **params})
            try:
                with self.opener.open(Request(url, headers={"Accept": "application/xml", "User-Agent": "HeritageImageMatcher/1.0"}), timeout=30) as response:
                    result = parse_xml(response.read(20 * 1024 * 1024 + 1))
                # Keep only credential-free responses on disk. Original image URLs exist in memory only.
                safe = sanitize(result, self.key)
                for source, dest in zip(result.get("list", []), safe.get("list", [])):
                    dest["protected_image_available"] = bool(source.get("imgUri") and not public_url(source["imgUri"]))
                write_json(cache_path, safe, private=True)
                return result
            except HTTPError as e:
                retry = e.code == 429 or 500 <= e.code < 600
                if e.code == 429:
                    self.rate_limits += 1
                error = APIError(f"HTTP_{e.code}", fatal=not retry)
                delay = e.headers.get("Retry-After", "")
                backoff = min(30.0, max(2.0 ** attempt, float(delay) if delay.isdigit() else 0.0))
            except (URLError, TimeoutError, ConnectionError):
                error, backoff = APIError("NETWORK_ERROR"), 2.0 ** attempt
            except APIError:
                self.failures += 1
                raise
            if error.fatal or attempt == 2:
                self.failures += 1
                raise error from None
            self.retries += 1
            time.sleep(backoff)
        raise APIError("RETRY_EXHAUSTED")

    def stats(self):
        return {"requests": self.calls, "cache_hits": self.cache_hits, "retries": self.retries,
                "http_rate_limits": self.rate_limits, "errors": self.failures,
                "minimum_interval_seconds": self.interval, "per_run_request_budget": self.budget}


def write_json(path: Path, value, *, private: bool = False):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600 if private else 0o644)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(value, f, ensure_ascii=False, indent=2)
        f.write("\n")
    temporary.replace(path)
