"""
Step 6: ML service health / metrics for the API's AI monitor, and the shadow-only contract for every model
name. Needs the v0 artifacts (skips otherwise, like test_service.py).
"""
import json
import os
import shutil

import pytest

from tests.test_service import BASE, H, REGISTRY, _client, _rows

from ml.schema import ALL_SPECS, SPECS


@pytest.fixture
def registry():
    if not os.path.exists(REGISTRY):
        pytest.skip("no v0 artifacts: run python -m ml.train --allow-synthetic")
    with open(REGISTRY) as f:
        return {m["name"]: m for m in json.load(f)["models"]}


def test_v2_health_needs_the_token_and_checks_every_artifact(monkeypatch, registry):
    c, _ = _client(monkeypatch)
    assert c.get("/v2/health").status_code == 401
    r = c.get("/v2/health", headers=H)
    assert r.status_code == 200
    body = r.json()
    assert body["may_serve_decisions"] is False
    names = {m["name"]: m for m in body["models"]}
    assert set(names) == set(registry)
    for name, m in names.items():
        assert m["fingerprint_ok"] is True, (name, m["problem"])
        assert m["may_serve_decisions"] is False
        assert m["sha256"] == registry[name]["sha256"]
    assert body["legacy_synthetic_models_loaded"] is False


def test_v2_health_reports_a_tampered_or_missing_artifact(monkeypatch, registry, tmp_path):
    c, main = _client(monkeypatch)
    art = tmp_path / "v0"
    shutil.copytree(os.path.dirname(REGISTRY), art)
    reg = json.loads((art / "registry.json").read_text())
    for m in reg["models"]:
        if m["name"] == "intent":
            m["sha256"] = "0" * 64
        if m["name"] == "crowd":
            os.remove(art / m["file"])
    (art / "registry.json").write_text(json.dumps(reg))
    monkeypatch.setattr(main, "ARTIFACT_DIR", str(art))
    models = {m["name"]: m for m in c.get("/v2/health", headers=H).json()["models"]}
    assert models["intent"]["fingerprint_ok"] is False and "fingerprint" in models["intent"]["problem"]
    assert models["crowd"]["fingerprint_ok"] is False and "missing" in models["crowd"]["problem"]
    assert models["fraud"]["fingerprint_ok"] is True


def test_v2_metrics_count_shadow_and_legacy_calls(monkeypatch, registry):
    c, _ = _client(monkeypatch)
    c.post("/v2/shadow/intent", headers=H, json={"sha256": registry["intent"]["sha256"], "rows": _rows("intent")})
    c.post("/v2/shadow/intent", headers=H, json={"sha256": "0" * 64, "rows": _rows("intent")})
    c.post("/fraud/score", headers=H, json={"checkout_duration_seconds": 30})
    m = c.get("/v2/metrics", headers=H).json()["routes"]
    assert m["/v2/shadow/intent"]["requests"] == 2
    assert m["/v2/shadow/intent"]["status_2xx"] == 1 and m["/v2/shadow/intent"]["status_4xx"] == 1
    assert m["/v2/shadow/intent"]["p95_ms"] is not None
    assert m["/fraud/score"]["status_2xx"] == 1


@pytest.mark.parametrize("name", sorted(ALL_SPECS))
def test_every_model_name_is_shadow_only_or_refused(monkeypatch, registry, name):
    """A registered model answers with may_serve_decisions false; a name with no artifact (attendance and the
    Step 5 models) is refused with a clear reason, never answered by a stand-in."""
    c, _ = _client(monkeypatch)
    if name in registry:
        r = c.post(f"/v2/shadow/{name}", headers=H, json={"sha256": registry[name]["sha256"], "rows": _rows(name, 2)})
        assert r.status_code == 200, r.text
        assert r.json()["may_serve_decisions"] is False and r.json()["role"] == "SHADOW"
    else:
        r = c.post(f"/v2/shadow/{name}", headers=H, json={"sha256": "0" * 64, "rows": [{"x": 1}]})
        assert r.status_code == 404
        assert ("not registered" in r.json()["detail"]) or ("unknown model" in r.json()["detail"])


def test_registry_never_allows_decisions(registry):
    for name, m in registry.items():
        assert m["may_serve_decisions"] is False, name
        assert m["source"].startswith("synthetic"), name
        assert name in SPECS
