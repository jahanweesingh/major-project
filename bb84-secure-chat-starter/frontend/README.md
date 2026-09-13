# QKD Chat Lab frontend

A responsive Phase-1 interface for the project's two-person classical chat. The UI deliberately states that BB84 key exchange and end-to-end encryption are not active yet.

## Local development

```sh
npm install
npm run dev
```

Vite serves the app at `http://localhost:5173` and proxies `/api` and `/ws` to the backend at `http://127.0.0.1:8000`.

## Quality checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

The Dockerfile exposes named `test`, `build`, and `runtime` stages. The runtime Nginx configuration serves the SPA and reverse-proxies same-origin REST and WebSocket traffic to a Compose service named `backend`.

## Backend contract

- `GET /api/health`
- `GET /api/rooms/{room_id}/messages?limit=50`
- `WS /ws/{room_id}?client_id=...&display_name=...`
- Client events: `message`, `typing`, and `ping`
- Server events: `connected`, `presence`, `message`, `message_ack`, `typing`, `pong`, and `error`

Rooms accept two distinct client IDs. Message text is limited to 2,000 characters. Capacity and identity close codes are terminal in the UI, while ordinary transport interruptions reconnect with capped exponential backoff.
