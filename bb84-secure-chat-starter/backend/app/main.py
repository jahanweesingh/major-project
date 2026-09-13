"""FastAPI application for a bounded, two-user real-time chat starter."""

from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime
from typing import Annotated

from fastapi import FastAPI, Path, Query, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from .config import Settings
from .connections import RoomConnectionManager
from .repository import SQLiteMessageRepository
from .schemas import (
    HealthResponse,
    HistoryResponse,
    MessageCommand,
    PingCommand,
    TypingCommand,
)

LOGGER = logging.getLogger(__name__)
IDENTIFIER_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"
IDENTIFIER_RE = re.compile(IDENTIFIER_PATTERN)


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def error_event(
    code: str,
    message: str,
    *,
    client_message_id: str | None = None,
) -> dict[str, str]:
    event = {"type": "error", "code": code, "message": message}
    if client_message_id is not None:
        event["client_message_id"] = client_message_id
    return event


def validate_identity(room_id: str, client_id: str, display_name: str) -> str | None:
    if not IDENTIFIER_RE.fullmatch(room_id):
        return "room_id must be 1-64 letters, numbers, underscores or hyphens"
    if not IDENTIFIER_RE.fullmatch(client_id):
        return "client_id must be 1-64 letters, numbers, underscores or hyphens"
    if not 1 <= len(display_name) <= 50 or display_name != display_name.strip():
        return "display_name must be 1-50 characters without outer whitespace"
    if any(ord(character) < 32 for character in display_name):
        return "display_name contains unsupported control characters"
    return None


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    repository = SQLiteMessageRepository(settings.database_path)
    manager = RoomConnectionManager()

    app = FastAPI(
        title="Secure Chat Starter API",
        version="0.1.0",
        description=(
            "Two-user persisted chat transport. Application-layer BB84 and AES "
            "are intentionally not implemented in this starter."
        ),
    )
    app.state.settings = settings
    app.state.repository = repository
    app.state.connection_manager = manager
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_credentials=False,
        allow_methods=["GET", "OPTIONS"],
        allow_headers=["Content-Type"],
        max_age=600,
    )

    @app.get("/api/health", response_model=HealthResponse)
    def health() -> dict[str, str]:
        repository.ping()
        return {
            "status": "ok",
            "database": "ok",
            "service": "secure-chat-starter",
        }

    @app.get("/api/rooms/{room_id}/messages", response_model=HistoryResponse)
    async def room_history(
        room_id: Annotated[
            str,
            Path(min_length=1, max_length=64, pattern=IDENTIFIER_PATTERN),
        ],
        limit: Annotated[int, Query(ge=1)] = 50,
    ) -> dict[str, object]:
        if limit > settings.max_history_limit:
            limit = settings.max_history_limit
        messages = await run_in_threadpool(repository.list_messages, room_id, limit)
        return {
            "room_id": room_id,
            "messages": [message.as_dict() for message in messages],
            "participants": await manager.participants(room_id),
        }

    @app.websocket("/ws/{room_id}")
    async def room_socket(
        websocket: WebSocket,
        room_id: str,
        client_id: str = Query(...),
        display_name: str = Query(...),
    ) -> None:
        await websocket.accept()
        origin = websocket.headers.get("origin")
        if (
            origin
            and "*" not in settings.allowed_origins
            and origin not in settings.allowed_origins
        ):
            await websocket.send_json(
                error_event("origin_not_allowed", "The WebSocket Origin is not allowed")
            )
            await websocket.close(code=4403, reason="origin not allowed")
            return
        identity_error = validate_identity(room_id, client_id, display_name)
        if identity_error:
            await websocket.send_json(error_event("invalid_identity", identity_error))
            await websocket.close(code=4400, reason="invalid identity")
            return

        joined = await manager.join(room_id, client_id, display_name, websocket)
        if joined.status != "joined":
            code = "room_full" if joined.status == "room_full" else joined.status
            message = (
                "This room already has two distinct clients"
                if code == "room_full"
                else "This client_id is already connected to the room"
            )
            await websocket.send_json(error_event(code, message))
            await websocket.close(
                code=4403 if code == "room_full" else 4409,
                reason=message,
            )
            return

        try:
            history = await run_in_threadpool(
                repository.list_messages,
                room_id,
                settings.default_history_limit,
            )
            await manager.send_to(
                room_id,
                client_id,
                {
                    "type": "connected",
                    "client_id": client_id,
                    "room_id": room_id,
                    "participants": joined.participants,
                    "messages": [message.as_dict() for message in history],
                },
            )
            await manager.broadcast(
                room_id,
                {
                    "type": "presence",
                    "action": "joined",
                    "client_id": client_id,
                    "display_name": display_name,
                    "participants": joined.participants,
                },
            )

            while True:
                packet = await websocket.receive()
                if packet["type"] == "websocket.disconnect":
                    break
                raw = packet.get("text")
                if raw is None:
                    await manager.send_to(
                        room_id,
                        client_id,
                        error_event("text_frames_only", "Only JSON text frames are accepted"),
                    )
                    continue
                if len(raw.encode("utf-8")) > settings.max_websocket_event_bytes:
                    await manager.send_to(
                        room_id,
                        client_id,
                        error_event("event_too_large", "WebSocket event is too large"),
                    )
                    continue
                try:
                    payload = json.loads(raw)
                except json.JSONDecodeError:
                    await manager.send_to(
                        room_id,
                        client_id,
                        error_event("invalid_json", "Event must contain valid JSON"),
                    )
                    continue
                if not isinstance(payload, dict):
                    await manager.send_to(
                        room_id,
                        client_id,
                        error_event("invalid_event", "Event must be a JSON object"),
                    )
                    continue

                event_type = payload.get("type")
                try:
                    if event_type == "message":
                        command = MessageCommand.model_validate(payload)
                        if len(command.text) > settings.max_message_length:
                            await manager.send_to(
                                room_id,
                                client_id,
                                error_event(
                                    "message_too_long",
                                    f"Message exceeds {settings.max_message_length} characters",
                                    client_message_id=command.client_message_id,
                                ),
                            )
                            continue
                        sent_at = utc_now()
                        message, created = await run_in_threadpool(
                            repository.create_message,
                            room_id=room_id,
                            client_message_id=command.client_message_id,
                            sender_id=client_id,
                            sender_name=display_name,
                            text=command.text,
                            sent_at=sent_at,
                        )
                        await manager.send_to(
                            room_id,
                            client_id,
                            {
                                "type": "message_ack",
                                "client_message_id": command.client_message_id,
                                "message_id": str(message.id),
                                "sent_at": message.sent_at,
                                "duplicate": not created,
                            },
                        )
                        if created:
                            await manager.broadcast(
                                room_id,
                                {"type": "message", "message": message.as_dict()},
                            )
                    elif event_type == "typing":
                        command = TypingCommand.model_validate(payload)
                        await manager.broadcast(
                            room_id,
                            {
                                "type": "typing",
                                "client_id": client_id,
                                "display_name": display_name,
                                "is_typing": command.is_typing,
                            },
                            exclude_client_id=client_id,
                        )
                    elif event_type == "ping":
                        PingCommand.model_validate(payload)
                        await manager.send_to(room_id, client_id, {"type": "pong"})
                    else:
                        await manager.send_to(
                            room_id,
                            client_id,
                            error_event("unsupported_event", "Unsupported event type"),
                        )
                except ValidationError:
                    rejected_message_id = payload.get("client_message_id")
                    if not (
                        event_type == "message"
                        and isinstance(rejected_message_id, str)
                        and 1 <= len(rejected_message_id) <= 64
                    ):
                        rejected_message_id = None
                    await manager.send_to(
                        room_id,
                        client_id,
                        error_event(
                            "validation_error",
                            "Event payload is invalid",
                            client_message_id=rejected_message_id,
                        ),
                    )
        except WebSocketDisconnect:
            pass
        except Exception:
            LOGGER.exception("Unexpected WebSocket failure in room %s", room_id)
            await manager.send_to(
                room_id,
                client_id,
                error_event("internal_error", "The server could not process the event"),
            )
        finally:
            removed, participants = await manager.leave(room_id, client_id, websocket)
            if removed:
                await manager.broadcast(
                    room_id,
                    {
                        "type": "presence",
                        "action": "left",
                        "client_id": client_id,
                        "display_name": display_name,
                        "participants": participants,
                    },
                )

    return app


app = create_app()
