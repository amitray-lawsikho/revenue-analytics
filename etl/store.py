"""Minimal Supabase (PostgREST) client using the service key. The key never appears in logs."""
from __future__ import annotations

import json
import os
import time

import requests

BATCH = 1000


class Store:
    def __init__(self, url: str | None = None, key: str | None = None):
        from etl.config import SUPABASE_URL
        self.url = (url or SUPABASE_URL).rstrip("/") + "/rest/v1/"
        key = key or os.environ["SUPABASE_SERVICE_KEY"]
        self.headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}

    def _call(self, method: str, path: str, **kw) -> requests.Response:
        for attempt in range(3):
            r = requests.request(method, self.url + path, headers={**self.headers, **kw.pop("headers", {})},
                                 timeout=120, **kw)
            if r.status_code < 500:
                break
            time.sleep(2 ** attempt)
        if r.status_code >= 300:
            raise RuntimeError(f"Supabase {method} {path.split('?')[0]} -> {r.status_code}: {r.text[:500]}")
        return r

    def select(self, table: str, query: str = "select=*") -> list[dict]:
        return self._call("GET", f"{table}?{query}").json()

    def upsert(self, table: str, rows: list[dict], on_conflict: str) -> None:
        for i in range(0, len(rows), BATCH):
            self._call("POST", f"{table}?on_conflict={on_conflict}",
                       headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
                       data=json.dumps(rows[i:i + BATCH], default=str))

    def delete(self, table: str, filter_: str) -> None:
        self._call("DELETE", f"{table}?{filter_}", headers={"Prefer": "return=minimal"})

    def insert(self, table: str, rows: list[dict]) -> None:
        self._call("POST", table, headers={"Prefer": "return=minimal"}, data=json.dumps(rows, default=str))
