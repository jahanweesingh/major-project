"""Environment-backed application configuration."""

from __future__ import annotations

import os
from dataclasses import dataclass


def _positive_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if value <= 0:
        raise ValueError(f"{name} must be greater than zero")
    return value


@dataclass(frozen=True, slots=True)
class Settings:
    database_path: str = "./data/chat.db"
    allowed_origins: tuple[str, ...] = (
        "http://localhost:3000",
        "http://localhost:5173",
    )
    default_history_limit: int = 50
    max_history_limit: int = 100
    max_message_length: int = 2_000
    max_websocket_event_bytes: int = 8_192

    @classmethod
    def from_env(cls) -> "Settings":
        history_limit = _positive_int("HISTORY_LIMIT", 100)
        origins = tuple(
            value.strip()
            for value in os.getenv(
                "ALLOWED_ORIGINS",
                "http://localhost:3000,http://localhost:5173",
            ).split(",")
            if value.strip()
        )
        return cls(
            database_path=os.getenv("DATABASE_PATH", "./data/chat.db"),
            allowed_origins=origins,
            default_history_limit=min(history_limit, 50),
            max_history_limit=history_limit,
            max_message_length=_positive_int("MAX_MESSAGE_LENGTH", 2_000),
            max_websocket_event_bytes=_positive_int(
                "MAX_WEBSOCKET_EVENT_BYTES", 8_192
            ),
        )
