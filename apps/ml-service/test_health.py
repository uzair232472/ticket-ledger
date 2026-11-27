from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_root():
    # The root's display name was changed on purpose (commit 6114e20); the API title is unchanged.
    # Check the root's contract: online, named, versioned, lists its endpoints and which models are loaded.
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["service"] == "TicketLedger AI Analytics & Bot Defense Engine (Module 15)"
    assert app.title == "TicketLedger ML Service"
    assert data["status"] == "online"
    assert data["version"]
    assert data["endpoints"]["fraud_score"] == "POST /fraud/score"
    assert set(data["models_loaded"]) == {"fraud_detection", "demand_forecasting", "purchase_intent"}

def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "ml-service"
    print("FastAPI Health Test Passed:", data)

if __name__ == "__main__":
    test_root()
    test_health()
    print("ALL ML-SERVICE TESTS PASSED.")
