# Testing Guide

## Full Docker verification

```bash
docker compose --profile test build
docker compose --profile test run --rm backend-test
docker compose --profile test run --rm frontend-test
docker compose up --build -d
docker compose --profile test run --rm smoke
```

The smoke test reaches the application through Nginx, connects Alice and Bob to
a new room, sends and acknowledges a message, verifies SQLite history, and
confirms that a third participant is rejected.

The latest completed verification record is in
[`docs/TEST_RESULTS.md`](TEST_RESULTS.md).

## Backend tests

```bash
cd backend
python -m pytest
```

The backend suite covers health, message history, WebSocket events, input
validation, room capacity, persistence and disconnect behaviour.

## Frontend tests

```bash
cd frontend
npm install
npm test
npm run typecheck
npm run lint
npm run build
```

The interface suite covers onboarding validation, connection states, message
composition and the visible Phase 1 security notice.

## Manual two-browser check

1. Open `http://localhost:8080` in two browser windows.
2. Enter different names and the same room code.
3. Send a message in each direction.
4. Confirm presence, typing state and timestamps.
5. Refresh one browser and confirm the saved history returns.
6. Try the same room in a third browser and confirm the room-full explanation.
7. Resize one window to a narrow mobile viewport and confirm the composer and
   messages remain usable without horizontal scrolling.
