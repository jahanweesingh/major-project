"""Small, thread-safe SQLite message repository."""

from __future__ import annotations

import sqlite3
import threading
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class MessageRecord:
    id: int
    client_message_id: str
    sender_id: str
    sender_name: str
    text: str
    sent_at: str

    def as_dict(self) -> dict[str, object]:
        return {
            "id": str(self.id),
            "client_message_id": self.client_message_id,
            "sender_id": self.sender_id,
            "sender_name": self.sender_name,
            "text": self.text,
            "sent_at": self.sent_at,
            "kind": "message",
        }


class SQLiteMessageRepository:
    def __init__(self, database_path: str) -> None:
        self.database_path = database_path
        self._lock = threading.RLock()
        if database_path != ":memory:":
            Path(database_path).parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=5.0)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 5000")
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def initialize(self) -> None:
        with self._lock, self._connect() as connection:
            if self.database_path != ":memory:":
                connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    room_id TEXT NOT NULL,
                    client_message_id TEXT NOT NULL,
                    sender_id TEXT NOT NULL,
                    sender_name TEXT NOT NULL,
                    text TEXT NOT NULL,
                    sent_at TEXT NOT NULL,
                    UNIQUE(room_id, sender_id, client_message_id)
                );
                CREATE INDEX IF NOT EXISTS idx_messages_room_id_id
                    ON messages(room_id, id DESC);
                """
            )
            connection.execute("PRAGMA optimize")

    @staticmethod
    def _row_to_record(row: sqlite3.Row) -> MessageRecord:
        return MessageRecord(
            id=row["id"],
            client_message_id=row["client_message_id"],
            sender_id=row["sender_id"],
            sender_name=row["sender_name"],
            text=row["text"],
            sent_at=row["sent_at"],
        )

    def create_message(
        self,
        *,
        room_id: str,
        client_message_id: str,
        sender_id: str,
        sender_name: str,
        text: str,
        sent_at: str,
    ) -> tuple[MessageRecord, bool]:
        with self._lock, self._connect() as connection:
            try:
                cursor = connection.execute(
                    """
                    INSERT INTO messages (
                        room_id, client_message_id, sender_id,
                        sender_name, text, sent_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        room_id,
                        client_message_id,
                        sender_id,
                        sender_name,
                        text,
                        sent_at,
                    ),
                )
                row = connection.execute(
                    "SELECT * FROM messages WHERE id = ?", (cursor.lastrowid,)
                ).fetchone()
                assert row is not None
                return self._row_to_record(row), True
            except sqlite3.IntegrityError:
                row = connection.execute(
                    """
                    SELECT * FROM messages
                    WHERE room_id = ? AND sender_id = ? AND client_message_id = ?
                    """,
                    (room_id, sender_id, client_message_id),
                ).fetchone()
                if row is None:
                    raise
                return self._row_to_record(row), False

    def list_messages(self, room_id: str, limit: int) -> list[MessageRecord]:
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM messages
                WHERE room_id = ?
                ORDER BY id DESC
                LIMIT ?
                """,
                (room_id, limit),
            ).fetchall()
        return [self._row_to_record(row) for row in reversed(rows)]

    def ping(self) -> bool:
        with self._lock, self._connect() as connection:
            return connection.execute("SELECT 1").fetchone()[0] == 1
