from __future__ import annotations

import sqlite3

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

from .conftest import receive_initial, socket_url


def test_health_and_empty_history_contract(client: TestClient) -> None:
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json() == {
        "status": "ok",
        "database": "ok",
        "service": "secure-chat-starter",
    }

    history = client.get("/api/rooms/demo/messages?limit=50")
    assert history.status_code == 200
    assert history.json() == {
        "room_id": "demo",
        "messages": [],
        "participants": [],
    }


def test_cors_allows_configured_origin_and_rejects_unknown_origin(
    client: TestClient,
) -> None:
    allowed = client.options(
        "/api/health",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"

    rejected = client.options(
        "/api/health",
        headers={
            "Origin": "https://untrusted.example",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert rejected.status_code == 400
    assert "access-control-allow-origin" not in rejected.headers


def test_history_is_persisted_ordered_limited_and_uses_string_ids(
    client: TestClient,
) -> None:
    with client.websocket_connect(socket_url()) as socket:
        receive_initial(socket)
        for number in range(1, 4):
            socket.send_json(
                {
                    "type": "message",
                    "text": f"message {number}",
                    "client_message_id": f"local-{number}",
                }
            )
            acknowledgement = socket.receive_json()
            broadcast = socket.receive_json()
            assert acknowledgement["type"] == "message_ack"
            assert isinstance(acknowledgement["message_id"], str)
            assert broadcast["type"] == "message"
            assert isinstance(broadcast["message"]["id"], str)

    response = client.get("/api/rooms/demo/messages?limit=2")
    assert response.status_code == 200
    body = response.json()
    assert [message["text"] for message in body["messages"]] == [
        "message 2",
        "message 3",
    ]
    assert [message["id"] for message in body["messages"]] == ["2", "3"]
    assert body["participants"] == []


def test_history_limit_is_safely_clamped(client: TestClient) -> None:
    assert client.get("/api/rooms/demo/messages?limit=9999").status_code == 200
    assert client.get("/api/rooms/demo/messages?limit=0").status_code == 422
    assert client.get("/api/rooms/not.valid/messages").status_code == 422


def test_sqlite_history_query_uses_room_id_index(
    client: TestClient, database_path
) -> None:
    assert client.get("/api/health").status_code == 200
    with sqlite3.connect(database_path) as connection:
        plan = connection.execute(
            """
            EXPLAIN QUERY PLAN
            SELECT * FROM messages
            WHERE room_id = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            ("demo", 50),
        ).fetchall()
    assert any("idx_messages_room_id_id" in str(row) for row in plan)


def test_messages_survive_application_restart(settings: Settings) -> None:
    with TestClient(create_app(settings)) as first_client:
        with first_client.websocket_connect(socket_url()) as socket:
            receive_initial(socket)
            socket.send_json(
                {
                    "type": "message",
                    "text": "persist me",
                    "client_message_id": "persist-1",
                }
            )
            assert socket.receive_json()["type"] == "message_ack"
            assert socket.receive_json()["type"] == "message"

    with TestClient(create_app(settings)) as second_client:
        body = second_client.get("/api/rooms/demo/messages").json()
    assert len(body["messages"]) == 1
    assert body["messages"][0]["text"] == "persist me"


def test_settings_use_portable_environment_names(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_PATH", "/tmp/example-chat.db")
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://one.test, https://two.test")
    monkeypatch.setenv("MAX_MESSAGE_LENGTH", "321")
    monkeypatch.setenv("HISTORY_LIMIT", "27")
    configured = Settings.from_env()
    assert configured.database_path == "/tmp/example-chat.db"
    assert configured.allowed_origins == ("https://one.test", "https://two.test")
    assert configured.max_message_length == 321
    assert configured.max_history_limit == 27
    assert configured.default_history_limit == 27
