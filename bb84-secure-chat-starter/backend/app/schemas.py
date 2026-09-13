"""Validated client commands and REST response models."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


CLIENT_MESSAGE_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$"


def _clean_text(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("text must not be empty")
    if any(ord(char) < 32 and char not in "\n\r\t" for char in value):
        raise ValueError("text contains unsupported control characters")
    return value


class MessageCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["message"]
    text: str
    client_message_id: str = Field(
        min_length=1,
        max_length=64,
        pattern=CLIENT_MESSAGE_ID_PATTERN,
    )

    _validate_text = field_validator("text")(_clean_text)


class TypingCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["typing"]
    is_typing: bool


class PingCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["ping"]


class StoredMessage(BaseModel):
    id: str
    client_message_id: str
    sender_id: str
    sender_name: str
    text: str
    sent_at: str
    kind: Literal["message"] = "message"


class Participant(BaseModel):
    client_id: str
    display_name: str


class HistoryResponse(BaseModel):
    room_id: str
    messages: list[StoredMessage]
    participants: list[Participant]


class HealthResponse(BaseModel):
    status: Literal["ok"]
    database: Literal["ok"]
    service: Literal["secure-chat-starter"]
