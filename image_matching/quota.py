"""Persistent per-operation daily limits. Contains counts only, never credentials."""
from datetime import datetime, timedelta
from pathlib import Path
import sqlite3
import time
from zoneinfo import ZoneInfo

from .api import APIError, Client

KST = ZoneInfo("Asia/Seoul")


def today():
    return datetime.now(KST).date().isoformat()


def next_reset():
    now = datetime.now(KST)
    return (now + timedelta(days=1)).replace(hour=0, minute=5, second=0, microsecond=0).timestamp()


class DailyQuotaReached(APIError):
    def __init__(self, operation, retry_at):
        self.operation, self.retry_at = operation, retry_at
        super().__init__("DAILY_LIMIT_" + operation.upper())


class QuotaLedger:
    def __init__(self, path: Path, limits: dict, initial_estimates: dict | None = None):
        self.limits = limits
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, timeout=30)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("CREATE TABLE IF NOT EXISTS daily (day TEXT, operation TEXT, used INTEGER NOT NULL, basis TEXT, PRIMARY KEY(day,operation))")
        for operation, used in (initial_estimates or {}).items():
            self.db.execute("INSERT OR IGNORE INTO daily VALUES(?,?,?,?)", (today(), operation, min(used, limits[operation]), "existing cache/image count plus conservative reserve; portal actual usage is not exposed"))
        self.db.commit()

    def reserve(self, operation):
        if operation not in self.limits:
            raise APIError("UNKNOWN_QUOTA_OPERATION", fatal=True)
        self.db.execute("BEGIN IMMEDIATE")
        try:
            self.db.execute("INSERT OR IGNORE INTO daily VALUES(?,?,0,'locally counted requests')", (today(), operation))
            used = self.db.execute("SELECT used FROM daily WHERE day=? AND operation=?", (today(), operation)).fetchone()[0]
            if used >= self.limits[operation]:
                self.db.rollback()
                raise DailyQuotaReached(operation, next_reset())
            self.db.execute("UPDATE daily SET used=used+1 WHERE day=? AND operation=?", (today(), operation))
            self.db.commit()
        except Exception:
            if self.db.in_transaction:
                self.db.rollback()
            raise

    def exhaust(self, operation):
        self.db.execute("INSERT INTO daily VALUES(?,?,?,'provider returned a daily-limit error') ON CONFLICT(day,operation) DO UPDATE SET used=excluded.used,basis=excluded.basis", (today(), operation, self.limits[operation]))
        self.db.commit()

    def status(self):
        rows = {op: (used, basis) for op, used, basis in self.db.execute("SELECT operation,used,basis FROM daily WHERE day=?", (today(),))}
        return {"date_kst": today(), "reset_timezone": "Asia/Seoul", "operations": {
            op: {"limit": limit, "counted_or_reserved": rows.get(op, (0, ""))[0],
                 "remaining_local_budget": max(0, limit - rows.get(op, (0, ""))[0]), "basis": rows.get(op, (0, ""))[1]}
            for op, limit in self.limits.items()}}


class DurableClient(Client):
    def __init__(self, env, private_dir, ledger):
        super().__init__(env, private_dir)
        self.ledger = ledger
        self.budget = 2 ** 63 - 1  # Per-day operation limits replace the pilot's per-process cap.
        self.last_operation = "list"
        self.operation_calls = {op: 0 for op in ledger.limits}

    def _pace(self, operation="list"):
        time.sleep(max(0.0, self.interval - (time.monotonic() - self.last_request)))
        self.ledger.reserve(operation)
        self.last_operation = operation
        self.last_request = time.monotonic()
        self.calls += 1
        self.operation_calls[operation] += 1

    def stats(self):
        return {**super().stats(), "calls_by_operation_this_process": dict(self.operation_calls), "daily": self.ledger.status()}
