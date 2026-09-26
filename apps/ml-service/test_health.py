from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_root():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json()["service"] == "TicketLedger ML Service"

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
