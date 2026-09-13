# Phase 1 Chat Architecture

## Runtime flow

```text
Browser A                       Browser B
    |                               |
    +----- HTTP and WebSocket ------+
                    |
             Nginx frontend
              localhost 8080
                    |
           FastAPI chat service
                    |
             SQLite database
             Docker volume
```

Nginx serves the compiled React application and forwards `/api` and `/ws`
requests to FastAPI. FastAPI validates room, participant and message input,
manages the live room connections, broadcasts ephemeral presence and typing
events, and stores durable messages in SQLite. A named Docker volume keeps the
database across normal container recreation.

## Trust boundary

This phase is a classical relay. The server receives message text and therefore
is trusted with plaintext. The service must never be described as end-to-end
encrypted or quantum secure. Production identity, TLS, rate limiting at the
edge, encrypted envelopes and BB84 session decisions are future work.

## Data ownership

The database is the authority for message history. Browser storage is limited
to device-local convenience values such as the participant name and room code.
Typing state and online presence are intentionally ephemeral.

## Portability

The production-like local topology uses two Linux containers and one named
volume. It does not depend on host Python or Node installations. Both the
Python and Node base images support common Intel, AMD and Apple Silicon Docker
hosts.

The normal configuration binds the browser port to `127.0.0.1`. For a
two-computer demonstration, `scripts/start_lan.sh` deliberately changes the
bind address to `0.0.0.0` and adds only the detected private host URL to the
Origin allowlist. Both participants then use that one host and one database.
