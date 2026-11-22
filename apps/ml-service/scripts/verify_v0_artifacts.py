"""
Verifies the v0 shadow-model artifacts against the tracked registry (models/v0/registry.json), and can rebuild
them and prove the rebuild is functionally identical.

    python scripts/verify_v0_artifacts.py                      # fingerprints + scikit-learn version
    python scripts/verify_v0_artifacts.py --rebuilt <dir>      # also compare a rebuild made with:
        python -m ml.train --allow-synthetic --artifacts <dir> --reports <reports dir>

The .joblib files are not tracked in git (*.joblib is ignored); registry.json is, with each artifact's SHA-256.
A rebuild from the tracked synthetic data (seed 0) gives the same predictions, thresholds and evaluation, but not
the same bytes (created_at, and pickle byte order for some estimators), so a rebuilt artifact has a NEW
fingerprint: the API's ML service refuses a file whose fingerprint differs from the registered one. To use a
rebuild, register its registry.json (apps/api/scripts/ml-register-models.mjs <dir>/registry.json): that retires
the old SHADOW row and registers the rebuild, again as SHADOW only. Nothing here registers, promotes or deploys.

Exit code 0 = everything verified; 1 = a check failed (listed).
"""
import argparse
import hashlib
import json
import os
import pickle
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

import joblib  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import sklearn  # noqa: E402

from ml.evaluate import load as load_dataset  # noqa: E402
from ml.models import predict as ml_predict  # noqa: E402
from ml.schema import SPECS  # noqa: E402


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def frame(spec, data_dir, rows):
    # The training loader (dates parsed, crowd baseline added); the first `rows` rows are compared
    return load_dataset(spec, data_dir).head(rows)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--artifacts", default=os.path.join(BASE_DIR, "models", "v0"))
    ap.add_argument("--rebuilt", default=None, help="directory with a rebuild to compare functionally")
    ap.add_argument("--data", default=os.path.join(BASE_DIR, "data"))
    ap.add_argument("--rows", type=int, default=20000, help="rows per dataset used for the prediction comparison")
    args = ap.parse_args()

    failures = []
    registry = json.load(open(os.path.join(args.artifacts, "registry.json"), encoding="utf-8"))
    print(f"registry: {registry.get('data_source')} (generator {registry.get('data_generator')}), service scikit-learn {sklearn.__version__}")
    rebuilt = None
    if args.rebuilt:
        rebuilt = {m["name"]: m for m in json.load(open(os.path.join(args.rebuilt, "registry.json"), encoding="utf-8"))["models"]}

    for m in registry["models"]:
        name = m["name"]
        path = os.path.join(args.artifacts, m["file"])
        problems = []
        if m.get("may_serve_decisions") is not False:
            problems.append("registry must say may_serve_decisions: false")
        if not os.path.exists(path):
            problems.append("artifact file missing")
        elif sha256(path) != m["sha256"]:
            problems.append("fingerprint does not match registry.json")
        if m.get("sklearn", "").split(".")[:2] != sklearn.__version__.split(".")[:2]:
            problems.append(f"built with scikit-learn {m.get('sklearn')}, service runs {sklearn.__version__}")
        line = f"{name:12s} {m['sha256'][:12]}  {'OK' if not problems else 'FAIL: ' + '; '.join(problems)}"

        if rebuilt is not None and not problems:
            r = rebuilt.get(name)
            if r is None:
                problems.append("not in the rebuild")
            else:
                a = joblib.load(path)
                b = joblib.load(os.path.join(args.rebuilt, r["file"]))
                spec = SPECS[name]
                df = frame(spec, args.data, args.rows)
                pa = np.asarray(ml_predict(a["model"], df, spec), float)
                pb = np.asarray(ml_predict(b["model"], df, spec), float)
                diff = float(np.max(np.abs(pa - pb))) if len(pa) else 0.0
                if diff > 1e-9:
                    problems.append(f"predictions differ (max {diff})")
                if pickle.dumps(a.get("thresholds")) != pickle.dumps(b.get("thresholds")):
                    problems.append("thresholds differ")
                if m.get("evaluation") != r.get("evaluation"):
                    problems.append("evaluation differs")
                if a.get("features") != b.get("features"):
                    problems.append("features differ")
                line += f" | rebuild {r['sha256'][:12]}: " + ("functionally identical" if not problems else "FAIL: " + "; ".join(problems)) + f" ({len(df)} rows)"
        print(line)
        if problems:
            failures.append(name)

    if failures:
        print(f"FAILED: {', '.join(failures)}")
        return 1
    print("all artifacts verified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
