# Phase 1 API Contract

## Health

`GET /api/health`

Returns the service and database health state.

## Room history

`GET /api/rooms/{room_id}/messages?limit=50`

Returns the room ID, oldest-to-newest recent messages, and participants who are
currently connected to this server process.

## Real-time connection

`WS /ws/{room_id}?client_id={id}&display_name={name}`

Room and client IDs contain 1 to 64 letters, numbers, underscores or hyphens.
Display names contain 1 to 50 visible characters. A room accepts two distinct
live client IDs.

### Client events

```json
{"type":"message","text":"Hello","client_message_id":"local-123"}
```

```json
{"type":"typing","is_typing":true}
```

```json
{"type":"ping"}
```

### Server events

- `connected` contains the participant snapshot and recent message history.
- `presence` contains the current participants after a join or leave.
- `message` contains the persisted message record.
- `message_ack` links the sender's client message ID to the stored message ID.
- `typing` describes the other participant's ephemeral typing state.
- `pong` confirms a live connection.
- `error` contains a stable code and a user-readable message. Rejected message
  commands also return `client_message_id` when available, allowing the sender
  to mark the matching optimistic message as failed and offer retry.

The most important error codes are `invalid_identity`, `room_full`,
`invalid_json`, `validation_error`, `message_too_long`, `event_too_large`,
`unsupported_event`, and `origin_not_allowed`.

## Current confidentiality

Message payloads are plaintext in this phase. A later phase should define a
versioned encrypted envelope instead of changing room, presence, typing and
transport semantics at the same time.
