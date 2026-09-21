#!/usr/bin/env python3
"""Fetch citation counts for the curated readings from OpenAlex (free, open).

    python3 scripts/update-citations.py

Reads the reading ids from content/readings.csv, looks each DOI up in the
reference data, and writes content/citations.json with the counts and the
retrieval date. scripts/build-page.js orders the reading list by these counts.
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
READINGS = ROOT / "content" / "readings.csv"
OUT = ROOT / "content" / "citations.json"
DATA_FILES = [ROOT / "assets" / "data" / "literature.json", ROOT / "assets" / "data" / "foundational-references.json"]
API = "https://api.openalex.org/works/doi:{doi}"
PAUSE_SECONDS = 0.2  # stay well under the API's rate limit


def main() -> None:
    refs = {}
    for path in DATA_FILES:
        refs.update({r["id"]: r for r in json.loads(path.read_text(encoding="utf-8"))["references"]})
    counts = {}
    for row in csv.DictReader(READINGS.open(encoding="utf-8")):
        doi = refs[row["id"]].get("doi")
        if not doi:
            raise SystemExit(f"{row['id']}: no DOI, cannot look up citations")
        with urllib.request.urlopen(API.format(doi=doi), timeout=30) as response:
            work = json.load(response)
        counts[row["id"]] = work["cited_by_count"]
        print(f"{row['id']:24} {counts[row['id']]}")
        time.sleep(PAUSE_SECONDS)
    OUT.write_text(json.dumps({
        "source": "OpenAlex",
        "retrieved": dt.date.today().isoformat(),
        "cited_by_count": counts,
    }, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
