"""Read selected columns from Google Sheets with the service account (no customer PII columns)."""
from __future__ import annotations

from typing import Iterable

from etl.rules import norm_header

CHUNK_ROWS = 25_000


def col_letter(i: int) -> str:
    """0 -> A, 25 -> Z, 26 -> AA."""
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def find_columns(header: list[str], wanted: dict[str, tuple[str, ...]], required: Iterable[str]) -> dict[str, int]:
    """Map each wanted field to its column index. Exact header match first, then prefix match."""
    h = [norm_header(x) for x in header]
    out: dict[str, int] = {}
    for field, names in wanted.items():
        idx = next((i for i, x in enumerate(h) if x in names), None)
        if idx is None:
            idx = next((i for i, x in enumerate(h) if any(x.startswith(n) for n in names)), None)
        if idx is not None:
            out[field] = idx
    missing = [f for f in required if f not in out]
    if missing:
        raise RuntimeError(f"Columns not found: {missing}. Header was: {header}")
    return out


def read_tab(svc, sheet_id: str, tab: str, wanted: dict[str, tuple[str, ...]], required: Iterable[str]) -> list[dict]:
    """Rows as dicts with only the wanted fields, plus '_row' (sheet row number)."""
    values = svc.spreadsheets().values()
    header = (values.get(spreadsheetId=sheet_id, range=f"'{tab}'!1:1").execute().get("values") or [[]])[0]
    cols = find_columns(header, wanted, required)
    rows: list[dict] = []
    start = 2
    while True:
        end = start + CHUNK_ROWS - 1
        ranges = [f"'{tab}'!{col_letter(i)}{start}:{col_letter(i)}{end}" for i in cols.values()]
        resp = values.batchGet(spreadsheetId=sheet_id, ranges=ranges, majorDimension="COLUMNS").execute()
        columns = [((vr.get("values") or [[]])[0]) for vr in resp.get("valueRanges", [])]
        n = max((len(c) for c in columns), default=0)
        if n == 0:
            break
        for k in range(n):
            row = {f: (c[k] if k < len(c) else "") for f, c in zip(cols.keys(), columns)}
            if any(str(v).strip() for v in row.values()):
                row["_row"] = start + k
                rows.append(row)
        if n < CHUNK_ROWS:
            break
        start = end + 1
    return rows
