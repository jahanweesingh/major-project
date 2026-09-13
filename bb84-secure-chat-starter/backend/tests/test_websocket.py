from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.config import Settings
from app.main import create_app

from .conftest import receive_initial, socket_url


def test_two_user_message_typing_ping_presence_and_ack_contract(
    client: TestClient,
) -> None:
    with client.websocket_connect(socket_url()) as alice:
        alice_connected, alice_joined = receive_initial(alice)
        assert alice_connected == {
            "type": "connected",
            "client_id": "alice",
            "room_id": "demo",
            "participants": [{"client_id": "alice", "display_name": "Alice"}],
            "messages": [],
        }
        assert alice_joined["action"] == "joined"

        with client.websocket_connect(
            socket_url(client_id="bob", display_name="Bob")
        ) as bob:
            bob_connected, bob_joined = receive_initial(bob)
            alice_sees_bob = alice.receive_json()
            expected_participants = [
                {"client_id": "alice", "display_name": "Alice"},
                {"client_id": "bob", "display_name": "Bob"},
            ]
            assert bob_connected["participants"] == expected_participants
            assert bob_joined == alice_sees_bob
            assert bob_joined == {
                "type": "presence",
                "action": "joined",
                "client_id": "bob",
                "display_name": "Bob",
                "participants": expected_participants,
            }

            alice.send_json({"type": "typing", "is_typing": True})
            assert bob.receive_json() == {
                "type": "typing",
                "client_id": "alice",
                "display_name": "Alice",
                "is_typing": True,
            }

            alice.send_json(
                {
                    "type": "message",
                    "text": "Hello Bob",
                    "client_message_id": "alice-1",
                }
            )
            acknowledgement = alice.receive_json()
            alice_message = alice.receive_json()
            bob_message = bob.receive_json()
            assert acknowledgement == {
                "type": "message_ack",
                "client_message_id": "alice-1",
                "message_id": "1",
                "sent_at": acknowledgement["sent_at"],
                "duplicate": False,
            }
            assert alice_message == bob_message
            assert alice_message["type"] == "message"
            assert alice_message["message"] == {
                "id": "1",
                "client_message_id": "alice-1",
                "sender_id": "alice",
                "sender_name": "Alice",
                "text": "Hello Bob",
                "sent_at": acknowledgement["sent_at"],
                "kind": "message",
            }

            bob.send_json({"type": "ping"})
            assert bob.receive_json() == {"type": "pong"}

            bob.close()
            assert alice.receive_json() == {
                "type": "presence",
                "action": "left",
                "client_id": "bob",
                "display_name": "Bob",
                "participants": [{"client_id": "alice", "display_name": "Alice"}],
            }


def test_duplicate_client_message_is_idempotent(client: TestClient) -> None:
    event = {
        "type": "message",
        "text": "Only once",
        "client_message_id": "retry-1",
    }
    with client.websocket_connect(socket_url()) as socket:
        receive_initial(socket)
        socket.send_json(event)
        first_ack = socket.receive_json()
        assert socket.receive_json()["type"] == "message"
        socket.send_json(event)
        duplicate_ack = socket.receive_json()

    assert first_ack["type"] == duplicate_ack["type"] == "message_ack"
    assert first_ack["message_id"] == duplicate_ack["message_id"] == "1"
    assert first_ack["duplicate"] is False
    assert duplicate_ack["duplicate"] is True
    history = client.get("/api/rooms/demo/messages").json()
    assert len(history["messages"]) == 1


def test_room_rejects_third_distinct_client(client: TestClient) -> None:
    with client.websocket_connect(socket_url()) as alice:
        receive_initial(alice)
        with client.websocket_connect(
            socket_url(client_id="bob", display_name="Bob")
        ) as bob:
            receive_initial(bob)
            assert alice.receive_json()["action"] == "joined"
            with client.websocket_connect(
                socket_url(client_id="charlie", display_name="Charlie")
            ) as charlie:
                assert charlie.receive_json() == {
                    "type": "error",
                    "code": "room_full",
                    "message": "This room already has two distinct clients",
                }
                with pytest.raises(WebSocketDisconnect) as closed:
                    charlie.receive_json()
                assert closed.value.code == 4403


def test_room_rejects_duplicate_active_client_id(client: TestClient) -> None:
    with client.websocket_connect(socket_url()) as alice:
        receive_initial(alice)
        with client.websocket_connect(socket_url(display_name="Other Alice")) as duplicate:
            assert duplicate.receive_json()["code"] == "client_already_connected"
            with pytest.raises(WebSocketDisconnect) as closed:
                duplicate.receive_json()
            assert closed.value.code == 4409


def test_websocket_origin_policy(client: TestClient, settings: Settings) -> None:
    with client.websocket_connect(
        socket_url(), headers={"origin": "http://localhost:5173"}
    ) as allowed:
        receive_initial(allowed)

    with client.websocket_connect(
        socket_url(), headers={"origin": "https://untrusted.example"}
    ) as rejected:
        assert rejected.receive_json() == {
            "type": "error",
            "code": "origin_not_allowed",
            "message": "The WebSocket Origin is not allowed",
        }
        with pytest.raises(WebSocketDisconnect) as closed:
            rejected.receive_json()
        assert closed.value.code == 4403

    wildcard_settings = Settings(
        database_path=settings.database_path + "-wildcard",
        allowed_origins=("*",),
    )
    with TestClient(create_app(wildcard_settings)) as wildcard_client:
        with wildcard_client.websocket_connect(
            socket_url(), headers={"origin": "https://any.example"}
        ) as allowed_by_wildcard:
            receive_initial(allowed_by_wildcard)


def test_invalid_identity_returns_structured_error(client: TestClient) -> None:
    with client.websocket_connect(socket_url(room_id="bad.room")) as socket:
        error = socket.receive_json()
        assert error["type"] == "error"
        assert error["code"] == "invalid_identity"
        with pytest.raises(WebSocketDisconnect) as closed:
            socket.receive_json()
        assert closed.value.code == 4400


def test_invalid_events_are_recoverable_and_bounded(client: TestClient) -> None:
    with client.websocket_connect(socket_url()) as socket:
        receive_initial(socket)

        socket.send_text("{")
        assert socket.receive_json()["code"] == "invalid_json"

        socket.send_json(["not", "an", "object"])
        assert socket.receive_json()["code"] == "invalid_event"

        socket.send_bytes(b"binary")
        assert socket.receive_json()["code"] == "text_frames_only"

        socket.send_json({"type": "unknown"})
        assert socket.receive_json()["code"] == "unsupported_event"

        socket.send_json({"type": "ping", "unexpected": True})
        assert socket.receive_json()["code"] == "validation_error"

        socket.send_json(
            {
                "type": "message",
                "text": "x" * 21,
                "client_message_id": "too-long",
            }
        )
        too_long = socket.receive_json()
        assert too_long["code"] == "message_too_long"
        assert too_long["client_message_id"] == "too-long"

        socket.send_json(
            {
                "type": "message",
                "text": "   ",
                "client_message_id": "empty-message",
            }
        )
        empty = socket.receive_json()
        assert empty["code"] == "validation_error"
        assert empty["client_message_id"] == "empty-message"

        socket.send_text("x" * 257)
        assert socket.receive_json()["code"] == "event_too_large"

        socket.send_json({"type": "ping"})
        assert socket.receive_json() == {"type": "pong"}
