# Verification Results

Verification date: **8 September 2026**

The checks below were run against the Phase 1 source and the final Docker
images. No release-blocking defect remains for the implemented chat scope.

## Automated checks

| Area | Result | Coverage |
| --- | --- | --- |
| Backend pytest | **14 passed** | REST health/history, WebSocket contract, validation, idempotency, two-user capacity, presence, typing, ping/pong, Origin policy, SQLite persistence and indexed query plan |
| Frontend Vitest/RTL | **9 passed** | API normalization, onboarding, history, live messaging, acknowledgement reconciliation, visible phase disclosure, copy action and terminal room-full handling |
| TypeScript | **Passed** | Full project type check |
| ESLint | **Passed** | Zero warnings allowed |
| Production frontend build | **Passed** | Vite production bundle generated successfully |
| npm dependency audit | **Passed** | 0 known vulnerabilities reported |
| Docker image build | **Passed** | Backend production/test and frontend runtime/test stages |
| Docker-only test profile | **Passed** | Backend and frontend suites executed inside Linux containers |

Pytest prints one dependency-level deprecation warning from Starlette's current
use of the AnyIO `BlockingPortal` compatibility alias. It does not come from
project code and does not affect execution.

## End-to-end Docker smoke test

The test reached the app through the public Nginx entry point and passed every
check:

- frontend proxy and database health;
- two simultaneous WebSocket participants;
- message broadcasts in both directions;
- sender acknowledgements with string message IDs;
- typing event delivery;
- ping/pong keepalive;
- SQLite history retrieval;
- third-participant rejection with close code `4403`.

The backend container was then restarted. Both smoke-test messages were still
returned from the same room, confirming that the named Docker volume preserves
history across container recreation.

## Browser and UI review

The final Docker build was exercised in Chrome through `http://localhost:8080`.

- Two tabs joined the same room as different participants.
- Typing feedback appeared in the other participant's tab.
- Messages and replies appeared in both tabs with sender acknowledgement.
- Refresh and rejoin restored the stored conversation.
- A third tab received the human-readable room-full state and did not enter a
  reconnect loop.
- Desktop onboarding and chat screens were visually inspected.
- At a 320 × 720 viewport, document width and scroll width were both 320 px.
- The mobile room drawer changed from visible to hidden after closing and its
  controls were removed from the visible accessibility tree.
- The exact `Phase 1 • classical transport` disclosure remained visible on
  mobile.
- Browser warning and error logs were empty in all three test tabs.

## Runtime status at handoff

- Backend container: healthy
- Frontend container: healthy
- Local URL: `http://localhost:8080`
- Message storage: named Docker volume

## LAN connectivity verification

The trusted-LAN helper was also validated after the original localhost handoff:

- automatic private-address detection selected the active Mac interface;
- public IPv4 input was rejected;
- Docker published the frontend as `0.0.0.0:8080` only in LAN mode;
- the generated backend Origin list contained localhost and the exact host LAN
  URL;
- the health endpoint responded through the host's LAN address; and
- a WebSocket client using that LAN Origin completed `connected`, `presence`
  and `pong` events successfully.

The running build is suitable for local development and academic demonstration.
It is not suitable for confidential data because Phase 1 does not yet implement
authentication, TLS termination, BB84, QBER-based session decisions, key
derivation, or end-to-end encryption.
