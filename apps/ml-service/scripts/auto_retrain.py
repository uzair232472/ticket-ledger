"""
Automatic retraining of CANDIDATE models from a database export. Safe to run on a schedule.

    python scripts/auto_retrain.py --data exports/<stamp> [--deployed models/v0]

  1. refuses anything that is not a database export (synthetic data never trains a real-client candidate)
  2. validates the export (scripts/validate_datasets.py); any integrity failure stops the run
  3. trains only the models with enough verified data (validator sufficiency, real-data minimums)
  4. evaluates each candidate on the newest, unseen period against the current rules AND the model the app
     runs now (manifest.deployed_models, found in --deployed by SHA-256)
  5. writes candidates to models/candidates/<stamp>/ and reports to reports/candidates/<stamp>/, plus
     retrain_summary.md/.json

It NEVER registers, promotes or deploys a model: it does not touch the database, models/v0, the ML
service or the app. A person reads the summary and, if they agree, registers a candidate in shadow mode
(apps/api/scripts/ml-register-models.mjs <candidate dir>/registry.json); serving decisions needs more.

Exit code: 0 = ran (even if nothing was trained), 1 = export failed validation, 2 = refused input.
"""

import argparse
import json
import os
import subprocess
import sys
import time

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

from ml.schema import SPECS  # noqa: E402


def _summary_md(s):
    L = [f"# Candidate retraining {s['stamp']}", "", f"Export: `{s['data']}` (exported {s.get('exported_at')}).",
         "**Nothing was registered, promoted or deployed.** Candidates are recommendations for a person to review.", ""]
    if s["status"] != "RAN":
        L += [f"Status: **{s['status']}**: {s.get('reason', '')}", ""]
    L += ["| Model | Verified data | Trained | Result | vs current rules | vs deployed model | Recommendation |", "|---|---|---|---|---|---|---|"]
    for name, m in s["models"].items():
        suff = "enough" if m["sufficient"] else f"not enough ({', '.join(m.get('short', []))})"
        res = m.get("result") or {}
        vs_rules = f"{res.get('model')} vs {res.get('baseline')} (CI {res.get('improvement_95ci')})" if res else "-"
        dep = m.get("deployed") or {}
        vs_dep = (f"{dep.get('candidate')} vs {dep.get('deployed')} (CI {dep.get('improvement_95ci')})" if dep.get("status") == "COMPARED"
                  else (dep.get("status") or "-"))
        L.append(f"| {name} | {suff} | {'yes' if m['trained'] else 'no'} | {m.get('status', '-')} | {vs_rules} | {vs_dep} | {m.get('recommendation', 'KEEP_CURRENT')} |")
    if s.get("warnings"):
        L += ["", "Validation warnings:"] + [f"- {w}" for w in s["warnings"]]
    return "\n".join(L) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", required=True)
    ap.add_argument("--deployed", default=os.path.join(BASE_DIR, "models", "v0"))
    ap.add_argument("--out", default=os.path.join(BASE_DIR, "models", "candidates"))
    ap.add_argument("--reports", default=os.path.join(BASE_DIR, "reports", "candidates"))
    ap.add_argument("--allow-test-fixture", action="store_true", help="tests only: accept an export marked test_fixture")
    args = ap.parse_args(argv)

    with open(os.path.join(args.data, "manifest.json")) as f:
        manifest = json.load(f)
    if manifest.get("source") != "db-export":
        print(f"Refusing: source is '{manifest.get('source')}', not a database export.")
        return 2
    if manifest.get("test_fixture") and not args.allow_test_fixture:
        print("Refusing: this export is a test fixture.")
        return 2

    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    rep_dir = os.path.join(args.reports, stamp)
    os.makedirs(rep_dir, exist_ok=True)
    summary = {"stamp": stamp, "data": os.path.abspath(args.data), "exported_at": manifest.get("exported_at"),
               "promoted": False, "registered": False, "deployed": False, "models": {}}

    vjson = os.path.join(rep_dir, "validation.json")
    v = subprocess.run([sys.executable, os.path.join(BASE_DIR, "scripts", "validate_datasets.py"), "--data", args.data, "--json", vjson]
                       + (["--allow-test-fixture"] if args.allow_test_fixture else []), capture_output=True, text=True)
    with open(os.path.join(rep_dir, "validation.txt"), "w", encoding="utf-8") as f:
        f.write(v.stdout + v.stderr)
    val = json.load(open(vjson)) if os.path.exists(vjson) else {"failures": ["validator did not run"], "sufficiency": None}
    summary["warnings"] = val.get("warnings", [])
    suff = val.get("sufficiency") or {}
    for name in SPECS:
        s = suff.get(name, {})
        summary["models"][name] = {"sufficient": bool(s.get("ready")), "have": s.get("have"), "short": s.get("short", []), "trained": False}

    def finish(status, reason=None, code=0):
        summary["status"] = status
        if reason:
            summary["reason"] = reason
        with open(os.path.join(rep_dir, "retrain_summary.json"), "w") as f:
            json.dump(summary, f, indent=2, default=str)
        with open(os.path.join(rep_dir, "retrain_summary.md"), "w", encoding="utf-8") as f:
            f.write(_summary_md(summary))
        print(f"{status}{': ' + reason if reason else ''}\nSummary: {os.path.join(rep_dir, 'retrain_summary.md')}")
        return code

    if v.returncode != 0:
        return finish("EXPORT_INVALID", f"{len(val.get('failures', []))} validation failure(s): {'; '.join(val.get('failures', [])[:5])}", 1)
    ready = [n for n, m in summary["models"].items() if m["sufficient"]]
    if not ready:
        return finish("NOTHING_TO_TRAIN", "no model has enough verified data yet")

    art_dir = os.path.join(args.out, stamp)
    os.makedirs(art_dir, exist_ok=True)
    t = subprocess.run([sys.executable, "-m", "ml.train", "--models", ",".join(ready), "--data", args.data,
                        "--reports", rep_dir, "--artifacts", art_dir, "--deployed", args.deployed]
                       + (["--allow-test-fixture"] if args.allow_test_fixture else []),
                       cwd=BASE_DIR, capture_output=True, text=True)
    with open(os.path.join(rep_dir, "train.log"), "w", encoding="utf-8") as f:
        f.write(t.stdout + t.stderr)
    if t.returncode != 0:
        return finish("TRAINING_FAILED", (t.stdout + t.stderr).strip().splitlines()[-1] if (t.stdout + t.stderr).strip() else "see train.log", 1)
    for name in ready:
        p = os.path.join(rep_dir, f"{name}.json")
        if not os.path.exists(p):
            continue
        r = json.load(open(p))
        summary["models"][name].update(trained=True, status=r["status"], result=r.get("result"), reasons=r.get("reasons", []),
                                       deployed=r.get("deployed_model"), recommendation=r.get("recommendation"),
                                       artifact=r.get("artifact"))
    summary["candidates_dir"] = os.path.abspath(art_dir)
    return finish("RAN")


if __name__ == "__main__":
    sys.exit(main())
