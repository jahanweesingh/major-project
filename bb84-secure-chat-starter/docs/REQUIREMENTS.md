# Phase 1 Requirements

These requirements translate the supplied project report into the first
implementable software milestone.

## Functional requirements

- A participant can enter a display name and create or join a room code.
- One room accepts no more than two distinct live client identifiers.
- Both participants receive new messages without refreshing the page.
- The sender receives an acknowledgement linked to its client message ID.
- Both participants can see who is online and when the other participant is
  typing.
- Recent messages are stored in SQLite and returned after reconnection.
- Empty, oversized or malformed messages are rejected without terminating the
  server.
- A disconnected participant is removed from live presence.

## Interface requirements

- Clear onboarding and room-sharing instructions.
- Useful connecting, connected, reconnecting, offline and error states.
- Responsive desktop and mobile layouts.
- Keyboard-accessible forms and controls with visible focus styles.
- Reduced-motion support.
- Human-readable empty, room-full and server-unavailable states.
- A persistent statement that Phase 1 uses classical plaintext transport and
  does not yet provide BB84 or end-to-end encryption.

## Portability requirements

- One Docker Compose command builds and starts the application.
- The browser entry point is `http://localhost:8080` by default.
- Message history survives normal container recreation through a named volume.
- No host Python or Node installation is required for normal use.
- Setup, test and troubleshooting instructions are included in the repository.

## Acceptance criteria

- Backend automated tests pass.
- Frontend tests, lint, type checking and production build pass.
- Docker images build and become healthy.
- A two-client smoke test sends, broadcasts, acknowledges and persists one
  message through the frontend proxy.
- A third live participant receives a room-full rejection.
- Browser review passes at desktop and mobile dimensions.
