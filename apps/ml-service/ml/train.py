"""
Train and evaluate models; write reports and (for models that pass) final artifacts.

    python -m ml.train --allow-synthetic                    # v0: all models on data/
    python -m ml.train --models intent,fraud --data DIR     # some models, another export
    python -m ml.train --data EXPORT --deployed models/v0   # + compare with the deployed (shadow) models

Candidates are compared with the model the app currently runs (listed in the export's manifest
`deployed_models`, found in --deployed by SHA-256). The result is a recommendation in the report; nothing
here registers, promotes or deploys a model.

Production exports carry source "db-export". Synthetic data ("synthetic-v0") is refused unless
--allow-synthetic is given, so a synthetic-trained model can never be produced by accident in
production; v0 artifacts are labelled with their source.
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time

from .evaluate import evaluate, recommendation, save_artifact
from .schema import SPECS

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Recorded decisions to keep a REJECTED model running in shadow (never serving decisions)
SHADOW_DECISIONS = {
    "fraud": {
        "date": "2026-11-20",
        "decision": "Option 1: the existing rules stay the active decision-making system; the v0 fraud model runs "
                    "in shadow only. The precision benchmark is not changed to let a synthetic-trained model pass.",
        "keep": "improved fraud recall and bot-detection capability (incl. human-speed bots) - tracked, not used",
        "record": "every shadow prediction, compared against verified fraud and verified legitimate outcomes",
        "re_evaluate": "on real client data once enough reviewed cases exist (minimums in ml/gates.py)",
        "measures": "precision (main), false-flag rate among legitimate orders (separate limit, <= 1%), "
                    "recall (tracked) - reported separately, never combined",
    },
}


def _fmt(v):
    return "-" if v is None else (f"{v:.4f}" if isinstance(v, float) else str(v))


def markdown(report):
    r = report
    lines = [f"# {r['title']} (`{r['model']}`)", "", f"**Status: {r['status']}**", ""]
    if r.get("reasons"):
        lines += ["Reasons:"] + [f"- {x}" for x in r["reasons"]] + [""]
    if r["status"] == "NOT_ENOUGH_DATA" and r.get("recommendation"):
        lines += [f"Recommendation: {r['recommendation']}", ""]
    d = r["data"]
    s = r["split"]
    lines += [f"Data: `{d['dataset']}`, {d['rows']:,} rows, {d['from'][:10]} to {d['to'][:10]}, source `{d['source']}`.",
              f"Split by time: train {s['train_rows']:,} / validation {s['val_rows']:,} / test {s['test_rows']:,} rows "
              f"(test from {s['test_start'][:10]}); {s['purged_train_rows'] + s['purged_val_rows']:,} rows purged at the cuts; "
              f"{s['holdout_groups']:,} groups held out entirely. Leakage checks: {r['leakage_checks']}.", ""]
    if "result" in r:
        res = r["result"]
        better = "higher is better" if r["higher_is_better"] else "lower is better"
        lines += ["## Main measure", f"{r['main_measure']} ({better}), newest 15% of the data:", "",
                  "| | Value |", "|---|---|",
                  f"| Model | {_fmt(res['model'])} |", f"| Baseline (current rule / strategy baseline) | {_fmt(res['baseline'])} |",
                  f"| Improvement | {_fmt(res['improvement'])} (95% interval {res['improvement_95ci'][0]} to {res['improvement_95ci'][1]}) |", ""]
        sel = r.get("complexity_selection")
        if sel:
            lines += ["## Model complexity (chosen on the validation period only)",
                      f"| Level | {sel['measure']} | Train vs validation | Not memorising |", "|---|---|---|---|"]
            lines += [f"| {x['level']}{' (chosen)' if x['level'] == sel['chosen'] else ''} | {x['validation_score']} | "
                      f"{x['train_vs_validation']} | {'yes' if x['not_memorising'] else 'no'} |" for x in sel["levels"]]
            lines += [""]
        lines += ["## Must not get worse", "| Check | Value | Limit | |", "|---|---|---|---|"]
        lines += [f"| {g['name']} | {_fmt(g['value'])} | {g['limit']} | {'pass' if g['passed'] else 'FAIL'} |" for g in r["guards"]]
        lines += ["", "## Known vs unseen customers / events, segments", "| Group | Rows | Model | Baseline |", "|---|---|---|---|"]
        for name, seg in r["segments"].items():
            lines.append(f"| {name} | {seg.get('rows', 0):,} | {_fmt(seg.get('model'))} | {_fmt(seg.get('baseline', seg.get('note')))} |")
        lc = r["learning_curve"]
        lines += ["", f"## Learning curve ({lc['measure']})", "| Share of training data | Rows | Value |", "|---|---|---|"]
        lines += [f"| {int(p['train_fraction'] * 100)}% | {p['train_rows']:,} | {p['value']} |" for p in lc["points"]]
        lines += ["", f"Reading: {lc['note']}.", ""]
        d = r.get("details", {})
        if "model_flags" in d:
            mf, rf = d["model_flags"], d["rule_flags"]
            lines += ["## Separate measures (not combined)", "| Measure | Model (shadow) | Current rules | Role |", "|---|---|---|---|",
                      f"| Precision: flags confirmed as fraud | {mf['precision']} | {rf['precision']} | main measure |",
                      f"| False flags among legitimate orders | {mf['false_flag_rate']} | {rf['false_flag_rate']} | limit <= {r['gates']['max_false_flag_rate']} |",
                      f"| Recall: frauds caught | {mf['recall']} | {rf['recall']} | tracked capability |",
                      f"| Share of orders flagged | {mf['flag_rate']} | {rf['flag_rate']} | reviewer workload |", ""]
        dep = r.get("deployed_model") or {}
        if dep.get("status") == "COMPARED":
            lines += ["## Compared with the deployed model",
                      f"Deployed `{dep['sha256'][:12]}` (trained on `{dep.get('source')}` data up to {str(dep.get('trained_to'))[:10]}), "
                      f"on the {dep['rows']:,} test rows newer than its training data:", "",
                      "| | Value |", "|---|---|", f"| Candidate | {_fmt(dep['candidate'])} |", f"| Deployed model | {_fmt(dep['deployed'])} |",
                      f"| Improvement | {_fmt(dep['improvement'])} (95% interval {dep['improvement_95ci'][0]} to {dep['improvement_95ci'][1]}) |", ""]
        elif dep:
            lines += ["## Compared with the deployed model", f"{dep['status']}" + (f": {'; '.join(dep.get('reasons', []))}" if dep.get("reasons") else "")
                      + (f" ({dep['reason']})" if dep.get("reason") else ""), ""]
        if r.get("recommendation"):
            lines += ["## Recommendation (not acted on automatically)", r["recommendation"], ""]
        if r.get("shadow_decision"):
            sd = r["shadow_decision"]
            lines += ["## Decision", f"{sd['decision']} ({sd['date']})", "",
                      f"- Keep: {sd['keep']}", f"- Record: {sd['record']}", f"- Re-evaluate: {sd['re_evaluate']}",
                      f"- Measures: {sd['measures']}", ""]
        if r.get("details"):
            lines += ["## Details", "```json", json.dumps(r["details"], indent=2), "```", ""]
        if r.get("final_model"):
            fm = r["final_model"]
            lines += ["## Final model", f"Refitted with the same settings on all {fm['trained_rows']:,} rows "
                      f"({fm['trained_from'][:10]} to {fm['trained_to'][:10]}). Calibration: {fm['calibration'] or 'n/a'}. "
                      "It starts in shadow mode: it must also beat the rules on live data before an admin can promote it.", ""]
    lines += [f"_Duration {r['duration_seconds']} s._"]
    return "\n".join(lines) + "\n"


def summary(reports, manifest):
    lines = ["# v0 model reports", "",
             f"Data source: `{manifest.get('source')}` (generator {manifest.get('generator_version')}, seed {manifest.get('seed')}). "
             "Each model is trained on the oldest 70% of its data, tuned on the next 15% and judged on the newest 15% against "
             "the rule the app uses today (or the AI strategy's baseline). Gates are in `ml/gates.py`.", "",
             "| Model | Main measure | Model | Baseline | Improvement (95% interval) | Status |", "|---|---|---|---|---|---|"]
    for r in reports:
        res = r.get("result", {})
        ci = res.get("improvement_95ci")
        lines.append(f"| [{r['title']}]({r['model']}.md) | {r['main_measure']} ({'higher' if r['higher_is_better'] else 'lower'} is better) | "
                     f"{_fmt(res.get('model'))} | {_fmt(res.get('baseline'))} | {_fmt(res.get('improvement'))}"
                     f"{f' ({ci[0]} to {ci[1]})' if ci else ''} | **{r['status']}** |")
    lines += ["", "**None of these results authorizes production use.** They come from synthetic data. PASSED models, and the "
              "fraud model by recorded decision (Option 1), ship in SHADOW mode only: they score live traffic in the background, "
              "every prediction is logged against the real outcome, and the rules keep making every decision. A model can only "
              "serve decisions after it passes this evaluation on the client's own data, passes the live shadow check, and an "
              "admin approves it.", "",
              "Attendance baseline: see [attendance_baseline_comparison.md](attendance_baseline_comparison.md).", ""]
    return "\n".join(lines)


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def write_registry(artifact_dir, reports, manifest):
    """registry.json: the artifacts the ML service may load and the API registers. Every entry is
    shadow-only unless trained on db-export data and PASSED (and even then the API still requires a
    live shadow check and admin approval before it serves decisions)."""
    import joblib
    models = []
    for r in reports:
        path = os.path.join(artifact_dir, f"{r['model']}.joblib")
        if not os.path.exists(path):
            continue
        art = joblib.load(path)
        models.append({
            "name": r["model"], "title": r["title"], "file": f"{r['model']}.joblib", "sha256": _sha256(path),
            "version": os.path.basename(os.path.normpath(artifact_dir)), "source": art["data_source"],
            "evaluation_status": r["status"], "may_serve_decisions": bool(art["may_serve_decisions"]),
            "shadow_decision": r.get("shadow_decision"), "sklearn": art["versions"]["sklearn"],
            "recommendation": r.get("recommendation"), "deployed_comparison": r.get("deployed_model"),
            "trained_rows": art["trained_rows"], "created_at": art["created_at"],
            "features": art["features"],      # exact inputs; the API's feature builders are tested against this
            "evaluation": {"main_measure": r["main_measure"], "higher_is_better": r["higher_is_better"],
                           **r.get("result", {}), "reasons": r.get("reasons", [])},
        })
    with open(os.path.join(artifact_dir, "registry.json"), "w") as f:
        json.dump({"data_source": manifest.get("source"), "data_generator": manifest.get("generator_version"),
                   "models": models}, f, indent=2)


def deployed_artifact(name, manifest, deployed_dir):
    """The artifact the app currently runs for `name` (manifest.deployed_models[name].sha256, exported from the
    app's model registry), loaded from deployed_dir after checking its SHA-256. None when nothing is deployed."""
    entry = (manifest.get("deployed_models") or {}).get(name)
    if not entry or not deployed_dir:
        return None
    import joblib
    reg_path = os.path.join(deployed_dir, "registry.json")
    files = []
    if os.path.exists(reg_path):
        with open(reg_path) as f:
            files = [m["file"] for m in json.load(f)["models"] if m["sha256"] == entry["sha256"]]
    files += [f"{name}.joblib"]
    for fn in files:
        path = os.path.join(deployed_dir, fn)
        if os.path.exists(path) and _sha256(path) == entry["sha256"]:
            return {"artifact": joblib.load(path), "sha256": entry["sha256"], "file": fn}
    print(f"   deployed {name} model {entry['sha256'][:12]} not found in {deployed_dir}: no comparison")
    return {"artifact": None, "sha256": entry["sha256"], "file": None}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--models", default="all")
    ap.add_argument("--data", default=os.path.join(BASE_DIR, "data"))
    ap.add_argument("--reports", default=os.path.join(BASE_DIR, "reports", "v0"))
    ap.add_argument("--artifacts", default=os.path.join(BASE_DIR, "models", "v0"))
    ap.add_argument("--allow-synthetic", action="store_true")
    ap.add_argument("--deployed", default=None, help="directory holding the deployed artifacts + registry.json")
    ap.add_argument("--allow-test-fixture", action="store_true", help="tests only: accept an export marked test_fixture")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args(argv)

    with open(os.path.join(args.data, "manifest.json")) as f:
        manifest = json.load(f)
    if manifest.get("source") != "db-export" and not args.allow_synthetic:
        print(f"Refusing to train on '{manifest.get('source')}' data without --allow-synthetic.")
        return 2
    if manifest.get("source") == "db-export" and args.allow_synthetic:
        print("Refusing: --allow-synthetic cannot be combined with a database export (real and synthetic data stay separate).")
        return 2
    if manifest.get("test_fixture") and not args.allow_test_fixture:
        print("Refusing: this export is a test fixture.")
        return 2
    check = subprocess.run([sys.executable, os.path.join(BASE_DIR, "scripts", "validate_datasets.py"), "--data", args.data]
                           + (["--allow-test-fixture"] if args.allow_test_fixture else []), capture_output=True, text=True)
    if check.returncode != 0:
        print(check.stdout[-3000:])
        print("Dataset validation failed: not training.")
        return 1
    print(check.stdout.strip().splitlines()[-1])

    names = list(SPECS) if args.models == "all" else args.models.split(",")
    os.makedirs(args.reports, exist_ok=True)
    reports = []
    t0 = time.time()
    for name in names:
        spec = SPECS[name]
        print(f"\n== {spec.title}")
        report, artifact = evaluate(spec, args.data, manifest, seed=args.seed, shadow_decision=SHADOW_DECISIONS.get(name) if manifest.get("source") != "db-export" else None,
                                    deployed=deployed_artifact(name, manifest, args.deployed))
        report["recommendation"] = recommendation(report) if report["status"] != "NOT_ENOUGH_DATA" else             "KEEP_CURRENT: not enough verified data to judge a candidate"
        if artifact is not None:
            path = os.path.join(args.artifacts, f"{name}.joblib")
            save_artifact(artifact, path)
            try:
                report["artifact"] = os.path.relpath(path, BASE_DIR).replace("\\", "/")
            except ValueError:            # different drive (Windows)
                report["artifact"] = path
        with open(os.path.join(args.reports, f"{name}.json"), "w") as f:
            json.dump(report, f, indent=2, default=str)
        with open(os.path.join(args.reports, f"{name}.md"), "w", encoding="utf-8") as f:
            f.write(markdown(report))
        res = report.get("result", {})
        print(f"   {report['status']}: model {res.get('model')} vs baseline {res.get('baseline')} "
              f"(95% CI of improvement {res.get('improvement_95ci')}) in {report['duration_seconds']} s")
        for reason in report.get("reasons", []):
            print(f"   - {reason}")
        reports.append(report)
    if args.models == "all" and manifest.get("source") != "db-export":
        with open(os.path.join(args.reports, "README.md"), "w", encoding="utf-8") as f:
            f.write(summary(reports, manifest))
    if os.path.isdir(args.artifacts):
        write_registry(args.artifacts, reports, manifest)
    print(f"\nDone in {time.time() - t0:.0f} s. Reports: {args.reports}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
