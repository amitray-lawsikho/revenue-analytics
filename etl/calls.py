"""Daily calling summary per call owner and dialler, computed inside BigQuery (only aggregates leave it)."""
from __future__ import annotations

from datetime import date

from etl.config import BQ_DATASET, BQ_PROJECT

T = f"`{BQ_PROJECT}.{BQ_DATASET}"

# Each block returns: d, owner, outbound, outbound_answered, inbound, inbound_answered, talk_sec, c2, c5, c15
_ACE_MCUBE = """
SELECT `Call Date` AS d, call_owner AS owner,
  COUNTIF(LOWER(direction)='outbound') AS outbound,
  COUNTIF(LOWER(direction)='outbound' AND LOWER(status)='answered') AS outbound_answered,
  COUNTIF(LOWER(direction)='inbound') AS inbound,
  COUNTIF(LOWER(direction)='inbound' AND LOWER(status)='answered') AS inbound_answered,
  SUM(IF(LOWER(status)='answered', IFNULL(call_duration,0), 0)) AS talk_sec,
  COUNTIF(LOWER(status)='answered' AND call_duration>=120) AS c2,
  COUNTIF(LOWER(status)='answered' AND call_duration>=300) AS c5,
  COUNTIF(LOWER(status)='answered' AND call_duration>=900) AS c15
FROM (
  SELECT * FROM {table}`
  WHERE `Call Date` >= @start
  QUALIFY ROW_NUMBER() OVER (PARTITION BY call_id ORDER BY updated_at DESC) = 1
)
GROUP BY 1, 2
"""

QUERIES = {
    "Acefone": _ACE_MCUBE.format(table=f"{T}.acefone_calls"),
    "MCube": _ACE_MCUBE.format(table=f"{T}.mcube_calls"),
    "Ozonetel": f"""
SELECT CallDate AS d, AgentName AS owner,
  COUNTIF(LOWER(Type)='manual') AS outbound,
  COUNTIF(LOWER(Type)='manual' AND LOWER(Status)='answered') AS outbound_answered,
  COUNTIF(LOWER(Type)='inbound') AS inbound,
  COUNTIF(LOWER(Type)='inbound' AND LOWER(Status)='answered') AS inbound_answered,
  SUM(IF(LOWER(Status)='answered', IFNULL(talktime_sec,0), 0)) AS talk_sec,
  COUNTIF(LOWER(Status)='answered' AND talktime_sec>=120) AS c2,
  COUNTIF(LOWER(Status)='answered' AND talktime_sec>=300) AS c5,
  COUNTIF(LOWER(Status)='answered' AND talktime_sec>=900) AS c15
FROM (
  SELECT * FROM {T}.ozonetel_calls`
  WHERE CallDate >= @start
  QUALIFY ROW_NUMBER() OVER (PARTITION BY CallID ORDER BY StartTime DESC) = 1
)
GROUP BY 1, 2
""",
    # Manual calls are approved, connected calls logged by hand: all outbound and answered.
    "Manual": f"""
SELECT Call_Date AS d, call_owner AS owner,
  COUNT(*) AS outbound, COUNT(*) AS outbound_answered, 0 AS inbound, 0 AS inbound_answered,
  SUM(IFNULL(call_duration,0)) AS talk_sec,
  COUNTIF(call_duration>=120) AS c2, COUNTIF(call_duration>=300) AS c5, COUNTIF(call_duration>=900) AS c15
FROM {T}.manual_calls`
WHERE Call_Date >= @start
GROUP BY 1, 2
""",
}


def fetch_daily(client, start: date) -> list[dict]:
    """Rows: {dialler, d, owner, outbound, ...} for every call date >= start."""
    from google.cloud import bigquery

    cfg = bigquery.QueryJobConfig(query_parameters=[bigquery.ScalarQueryParameter("start", "DATE", start)])
    out: list[dict] = []
    for dialler, sql in QUERIES.items():
        for r in client.query(sql, job_config=cfg).result():
            row = dict(r.items())
            row["dialler"] = dialler
            out.append(row)
    return out
