"""
PUBLIC datasets for development experiments only (data-source class PUBLIC). They are NOT TicketLedger data,
never enter a database export, can never train a candidate for the app (ml.train refuses them) and their results
are never evidence of real-world performance.

    python scripts/fetch_public_datasets.py [--list] [--only online_shoppers]

Each dataset is downloaded into data/public/<name>/ (raw files are git-ignored: re-fetch with this script) with a
manifest.json: source URL, license, citation, SHA-256 of the archive, download time. Licenses were checked on the
publisher's page (2026-11-21).
"""

import argparse
import datetime as dt
import hashlib
import io
import json
import os
import sys
import urllib.request
import zipfile

BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "public")

CATALOGUE = {
    "online_shoppers": {
        "title": "Online Shoppers Purchasing Intention Dataset",
        "url": "https://archive.ics.uci.edu/static/public/468/online+shoppers+purchasing+intention+dataset.zip",
        "page": "https://archive.ics.uci.edu/dataset/468/online+shoppers+purchasing+intention+dataset",
        "license": "CC BY 4.0 (Creative Commons Attribution 4.0 International); credit required",
        "citation": "Sakar, C. & Kastro, Y. (2018). Online Shoppers Purchasing Intention Dataset [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C5F88Q",
        "rows": 12330, "label": "Revenue (session ended with a purchase)",
        "feature": "A. Purchase intent (experimentation only)",
        "suitability": "E-commerce browsing sessions (one shop, one year, months without a year), not event ticketing: no event, "
                       "price, seat or days-to-event fields. Useful to exercise the intent pipeline, calibration and the "
                       "new-vs-returning split (VisitorType); NOT usable to train or validate TicketLedger models.",
        "files": ["online_shoppers_intention.csv"], "fetch": True,
    },
    "online_retail_ii": {
        "title": "Online Retail II",
        "url": "https://archive.ics.uci.edu/static/public/502/online+retail+ii.zip",
        "page": "https://archive.ics.uci.edu/dataset/502/online+retail+ii",
        "license": "CC BY 4.0 (Creative Commons Attribution 4.0 International); credit required",
        "citation": "Chen, D. (2012). Online Retail II [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C5CG6D",
        "rows": 1067371, "label": "none (transactions; 'C' invoices are cancellations)",
        "feature": "D. Customer behaviour (report-method experiments only)",
        "suitability": "Gift-ware wholesale/retail transactions: repeat purchases and spending patterns can exercise the "
                       "behaviour reports, but customers, products and seasonality are unrelated to ticketing. Not fetched "
                       "by default (43.5 MB xlsx, needs openpyxl).",
        "files": ["online_retail_II.xlsx"], "fetch": False,
    },
}
# Looked at and NOT used
REJECTED = {
    "hotel_booking_demand": "Antonio et al., Data in Brief 2019: the publisher page could not be read (HTTP 403), so the license "
                            "was not verified; cancellations are not ticket no-shows. Not used.",
    "kaggle_event_recommendation_challenge": "Kaggle competition data: the rules page could not be read (script-rendered), and "
                                             "competition data is normally limited to the competition. Not used.",
    "credit_card_fraud": "Card-transaction fraud (anonymised PCA features): unrelated to ticket scalping bots. Not used.",
    "crowd_flow": "No public dataset of venue gate scans per 5 minutes was found. Crowd flow stays synthetic until real gate data exists.",
}


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def fetch(name, meta):
    out = os.path.join(BASE, name)
    os.makedirs(out, exist_ok=True)
    req = urllib.request.Request(meta["url"], headers={"User-Agent": "dataset-fetch/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        blob = r.read()
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        for member in z.namelist():
            base = os.path.basename(member)
            if base in meta["files"]:
                with open(os.path.join(out, base), "wb") as f:
                    f.write(z.read(member))
    manifest = {"source_class": "PUBLIC", "name": name, **{k: meta[k] for k in ("title", "url", "page", "license", "citation", "label", "feature", "suitability")},
                "archive_sha256": sha256(blob), "files": {fn: sha256(open(os.path.join(out, fn), "rb").read()) for fn in meta["files"]},
                "downloaded_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                "never": "train or evaluate a TicketLedger candidate; be presented as TicketLedger customer data"}
    with open(os.path.join(out, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    return manifest


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--only", default=None)
    args = ap.parse_args(argv)
    if args.list:
        print(json.dumps({"catalogue": CATALOGUE, "rejected": REJECTED}, indent=2))
        return 0
    for name, meta in CATALOGUE.items():
        if (args.only and name != args.only) or (not args.only and not meta["fetch"]):
            continue
        m = fetch(name, meta)
        print(f"{name}: {', '.join(m['files'])} (archive sha256 {m['archive_sha256'][:12]}) -> data/public/{name}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
