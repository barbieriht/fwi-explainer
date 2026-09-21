#!/usr/bin/env python3
"""Aggregate snapshot of the author's Zotero collection for the page.

    cp ~/Zotero/zotero.sqlite /tmp/zotero-copy.sqlite      # Zotero locks the live file
    python3 scripts/import-zotero.py /tmp/zotero-copy.sqlite --collection Seismic

Reads the collection and all its sub-collections (except those named in
--exclude), removes duplicates by DOI or normalized title, and classifies
each study by an explicit keyword rule on its title and abstract. Only
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
TOP_VENUES = 8  # venues shown on the page; the rest are summed as "other"
VENUE_FIELDS = ("publicationTitle", "proceedingsTitle", "bookTitle")

# Topic -> pattern searched in lower-cased title + abstract. Only "ml" is shown
# on the page (share of studies mentioning machine learning / deep learning).
TOPIC_RULES = {
    "ml": r"deep learning|machine learning|neural network|\bcnns?\b|convolutional|transformer|"
          r"diffusion model|generative|autoencoder|\bgans?\b|u-?net|learning-based|physics-informed neural",
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
        venue = next((v for v in (field(con, item, f).strip() for f in VENUE_FIELDS) if v), "")
        out.append({"year": int(year.group(0)) if year else None, "venue": venue,
                    "text": (title + " " + field(con, item, "abstractNote")).lower()})
    return out


def venue_key(name: str) -> str:
    """Case- and punctuation-insensitive key, so 'Computers & Geosciences' and
    'Computers and Geosciences' count as one venue."""
    return re.sub(r"[^a-z0-9]", "", name.lower().replace("&", "and"))


def venue_counts(found: list[dict], ml: re.Pattern) -> tuple[list[dict], int, int]:
    names: dict[str, Counter] = {}
    totals: Counter = Counter()
    ml_counts: Counter = Counter()
    no_venue = 0
    for s in found:
        if not s["venue"]:
            no_venue += 1
            continue
        key = venue_key(s["venue"])
        names.setdefault(key, Counter())[s["venue"]] += 1
        totals[key] += 1
        if ml.search(s["text"]):
            ml_counts[key] += 1
    ranked = sorted(totals, key=lambda k: (-totals[k], k))
    top = [{"venue": names[k].most_common(1)[0][0], "total": totals[k], "ml": ml_counts[k]} for k in ranked[:TOP_VENUES]]
    other = sum(totals[k] for k in ranked[TOP_VENUES:])
    return top, other, no_venue


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

    venues, other_venues, no_venue = venue_counts(found, patterns["ml"])
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
        "venues": venues,
        "other_venues": other_venues,
        "no_venue": no_venue,
    }, indent=2, ensure_ascii=False)
    OUT_JSON.write_text(payload + "\n", encoding="utf-8")
    OUT_JS.write_text("/* Generated by scripts/import-zotero.py from search-snapshot.json; do not edit. */\n"
                      "window.FWI_DATA = window.FWI_DATA || {};\n"
                      "window.FWI_DATA.searchSnapshot = " + payload + ";\n", encoding="utf-8")
    print(f"{len(found)} studies ({unknown_year} without year); topics: {dict(totals)}")


if __name__ == "__main__":
    main()
