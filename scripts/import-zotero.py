#!/usr/bin/env python3
"""Aggregate snapshot of the author's Zotero collection for the page.

    cp ~/Zotero/zotero.sqlite /tmp/zotero-copy.sqlite      # Zotero locks the live file
    python3 scripts/import-zotero.py /tmp/zotero-copy.sqlite --collection Seismic

Reads the collection and all its sub-collections (except those named in
--exclude), removes duplicates by DOI or normalized title, and classifies
each study by explicit keyword rules on its title and abstract. Only
aggregate counts are written (assets/data/search-snapshot.json and a .js
twin for file:// use); no title, abstract or other per-study field leaves
this script. The database is opened read-only.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sqlite3
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_JSON = ROOT / "assets" / "data" / "search-snapshot.json"
OUT_JS = ROOT / "assets" / "data" / "search-snapshot.js"
NON_STUDY_TYPES = ("attachment", "note", "annotation")
EARLY_YEAR = 2016  # years up to this one are grouped

# Topic -> pattern searched in lower-cased title + abstract. Order = display order.
TOPIC_RULES = {
    "ml": r"deep learning|machine learning|neural network|\bcnns?\b|convolutional|transformer|"
          r"diffusion model|generative|autoencoder|\bgans?\b|u-?net|learning-based|physics-informed neural",
    "multiparameter": r"multi-?parameter|elastic|anisotrop|density|shear[- ]wave|\bs-wave|petrophysical",
    "time-lapse": r"time-lapse|time lapse|\b4d\b|monitoring|\bco2\b|co₂",
    "uncertainty": r"uncertaint|bayesian|posterior|probabilistic|variational inference|monte carlo",
    "cycle-skipping": r"cycle[- ]skipping|local minim|misfit function|objective function|optimal transport|"
                      r"low[- ]frequenc",
}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("database", type=Path, help="a copy of zotero.sqlite")
    p.add_argument("--collection", required=True, help="name of the top-level collection")
    p.add_argument("--exclude", nargs="*", default=["Removed"], help="sub-collection names to skip")
    p.add_argument("--partial-year", type=int, default=dt.date.today().year,
                   help="year still in progress, flagged as partial on the page")
    return p.parse_args()


def subtree(con: sqlite3.Connection, name: str, exclude: list[str]) -> list[int]:
    rows = con.execute("select collectionID, collectionName, parentCollectionID from collections").fetchall()
    roots = [cid for cid, cname, parent in rows if cname == name and parent is None]
    if len(roots) != 1:
        raise SystemExit(f"expected one top-level collection named {name!r}, found {len(roots)}")
    children: dict[int, list[tuple[int, str]]] = {}
    for cid, cname, parent in rows:
        children.setdefault(parent, []).append((cid, cname))
    out, stack = [], [roots[0]]
    while stack:
        cid = stack.pop()
        out.append(cid)
        stack.extend(child for child, cname in children.get(cid, []) if cname not in exclude)
    return out


def field(con: sqlite3.Connection, item: int, name: str) -> str:
    row = con.execute(
        "select v.value from itemData d join fields f on f.fieldID = d.fieldID "
        "join itemDataValues v on v.valueID = d.valueID where d.itemID = ? and f.fieldName = ?",
        (item, name)).fetchone()
    return row[0] if row else ""


def studies(con: sqlite3.Connection, collections: list[int]) -> list[dict]:
    marks = ",".join("?" * len(collections))
    types = ",".join("?" * len(NON_STUDY_TYPES))
    ids = [r[0] for r in con.execute(
        f"select distinct ci.itemID from collectionItems ci join items it on it.itemID = ci.itemID "
        f"join itemTypes t on t.itemTypeID = it.itemTypeID "
        f"where ci.collectionID in ({marks}) and t.typeName not in ({types})",
        (*collections, *NON_STUDY_TYPES))]
    seen, out = set(), []
    for item in ids:
        title = field(con, item, "title")
        doi = field(con, item, "DOI").strip().lower()
        key = doi or re.sub(r"[^a-z0-9]", "", title.lower())
        if not key or key in seen:
            continue
        seen.add(key)
        year = re.search(r"\b(19|20)\d{2}\b", field(con, item, "date"))
        out.append({"year": int(year.group(0)) if year else None,
                    "text": (title + " " + field(con, item, "abstractNote")).lower()})
    return out


def year_bucket(year: int | None) -> str:
    if year is None:
        return "unknown"
    return f"≤{EARLY_YEAR}" if year <= EARLY_YEAR else str(year)


def main() -> None:
    args = parse_args()
    con = sqlite3.connect(f"file:{args.database}?mode=ro", uri=True)
    found = studies(con, subtree(con, args.collection, args.exclude))
    patterns = {topic: re.compile(rule) for topic, rule in TOPIC_RULES.items()}

    buckets = sorted({year_bucket(s["year"]) for s in found if s["year"] is not None},
                     key=lambda b: -1 if b.startswith("≤") else int(b))
    by_year = {b: {"total": 0, **{t: 0 for t in TOPIC_RULES}} for b in buckets}
    totals = Counter()
    unknown_year = 0
    for s in found:
        hits = [t for t, rx in patterns.items() if rx.search(s["text"])]
        totals.update(hits)
        if s["year"] is None:
            unknown_year += 1
            continue
        row = by_year[year_bucket(s["year"])]
        row["total"] += 1
        for t in hits:
            row[t] += 1

    payload = json.dumps({
        "_about": "Generated by scripts/import-zotero.py. Aggregate counts only; topics follow keyword rules "
                  "on title + abstract. A collection built from searches, not a screened review.",
        "snapshot_date": dt.date.today().isoformat(),
        "studies": len(found),
        "unknown_year": unknown_year,
        "partial_year": str(args.partial_year),
        "topics": list(TOPIC_RULES),
        "topic_rules": TOPIC_RULES,
        "topic_totals": {t: totals[t] for t in TOPIC_RULES},
        "years": [{"year": b, **by_year[b]} for b in buckets],
    }, indent=2, ensure_ascii=False)
    OUT_JSON.write_text(payload + "\n", encoding="utf-8")
    OUT_JS.write_text("/* Generated by scripts/import-zotero.py from search-snapshot.json; do not edit. */\n"
                      "window.FWI_DATA = window.FWI_DATA || {};\n"
                      "window.FWI_DATA.searchSnapshot = " + payload + ";\n", encoding="utf-8")
    print(f"{len(found)} studies ({unknown_year} without year); topics: {dict(totals)}")


if __name__ == "__main__":
    main()
