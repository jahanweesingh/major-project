# Secure Chat Starter Backend

FastAPI and SQLite starter for a persistent, two-user real-time chat. This slice implements transport, validation, presence and persistence only. It does **not** implement or claim BB84, quantum key distribution, AES encryption, authentication or end-to-end encryption.

## Run locally

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload
```

The API is available at `http://127.0.0.1:8000`.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_PATH` | `./data/chat.db` | SQLite file |
| `ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:5173` | Comma-separated browser origins |
| `MAX_MESSAGE_LENGTH` | `2000` | Maximum characters in one message |
| `HISTORY_LIMIT` | `100` | Maximum messages returned or sent at connection |
| `MAX_WEBSOCKET_EVENT_BYTES` | `8192` | Maximum encoded client event size |

Set `HOST` and `PORT` in Docker Compose and pass them to the Uvicorn command when a deployment needs values other than `0.0.0.0:8000`.

## Fixed contract

- `GET /api/health`
- `GET /api/rooms/{room_id}/messages?limit=50`
- `WS /ws/{room_id}?client_id=alice&display_name=Alice`

Client events:

```json
{"type":"message","text":"Hello","client_message_id":"local-1"}
{"type":"typing","is_typing":true}
{"type":"ping"}
```

Server events:

```json
{"type":"connected","client_id":"alice","room_id":"demo","participants":[],"messages":[]}
{"type":"presence","action":"joined","client_id":"alice","display_name":"Alice","participants":[]}
{"type":"message","message":{"id":"1","client_message_id":"local-1","sender_id":"alice","sender_name":"Alice","text":"Hello","sent_at":"2026-09-08T00:00:00.000Z","kind":"message"}}
{"type":"message_ack","client_message_id":"local-1","message_id":"1","sent_at":"2026-09-08T00:00:00.000Z","duplicate":false}
{"type":"typing","client_id":"alice","display_name":"Alice","is_typing":true}
{"type":"pong"}
{"type":"error","code":"validation_error","message":"Event payload is invalid","client_message_id":"local-1"}
```

Messages are acknowledged before their broadcast. Retrying the same `client_message_id` for the same sender and room returns the existing acknowledgement without persisting or broadcasting a duplicate. Errors for rejected message commands include `client_message_id` when it is available so the UI can reconcile the failed optimistic item. A room accepts at most two distinct active `client_id` values.

## Docker

```bash
docker build -t secure-chat-starter .
docker run --rm -p 8000:8000 -v secure-chat-data:/data secure-chat-starter

# Run tests using Docker only
docker build --target test -t secure-chat-starter-test .
docker run --rm secure-chat-starter-test
```

The production image is the final `production` stage and runs as non-root user 10001. The named `test` stage contains the development dependencies and test suite.

Use a TLS reverse proxy so browsers connect through HTTPS and WSS outside local development. Browser WebSocket origins are checked against `ALLOWED_ORIGINS`; non-browser clients may omit `Origin`. The current client identifiers are self-asserted and must not be treated as authenticated identities.
