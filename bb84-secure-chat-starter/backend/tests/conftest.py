from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def database_path(tmp_path: Path) -> Path:
    return tmp_path / "chat-test.db"


@pytest.fixture
def settings(database_path: Path) -> Settings:
    return Settings(
        database_path=str(database_path),
        allowed_origins=("http://localhost:5173",),
        default_history_limit=50,
        max_history_limit=100,
        max_message_length=20,
        max_websocket_event_bytes=256,
    )


@pytest.fixture
def client(settings: Settings) -> TestClient:
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def socket_url(
    room_id: str = "demo",
    client_id: str = "alice",
    display_name: str = "Alice",
) -> str:
    return (
        f"/ws/{room_id}?client_id={client_id}"
        f"&display_name={display_name}"
    )


def receive_initial(socket) -> tuple[dict, dict]:
    connected = socket.receive_json()
    presence = socket.receive_json()
    assert connected["type"] == "connected"
    assert presence["type"] == "presence"
    return connected, presence
