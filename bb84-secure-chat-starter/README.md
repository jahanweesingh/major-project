# QKD Chat Lab

QKD Chat Lab is the working Phase 1 foundation for the **BB84-QKD Based Secure
Chat Application** described in the supplied project report. This release
implements a polished two-person chat experience with real-time delivery,
typing and presence indicators, acknowledgements, and persistent local
history.

> **Security status:** this phase uses classical WebSocket transport and stores
> plaintext messages in SQLite. BB84, QBER analysis, key derivation and
> AES-GCM message encryption are deliberately reserved for later phases. Do
> not use this build for confidential communication.

## Run it on localhost

You only need Docker Desktop or another Docker Compose-compatible runtime.

```bash
cp .env.example .env
docker compose up --build -d
```

Open [http://localhost:8080](http://localhost:8080), then:

1. Enter your name and create a room.
2. Copy the room code.
3. Open another browser or private window, choose **Join room**, and enter that
   code with a different name.
4. Send messages in both directions. Refresh either window to verify that the
   history remains available.

## Chat between two Macs

`localhost` cannot connect two computers. Run the project on **one host Mac**
and let both people open that Mac's private network address.

On the host Mac:

```bash
./scripts/start_lan.sh
```

The helper detects the private LAN address, creates an untracked `.env.lan`
with the exact WebSocket Origin, starts Docker, and prints a URL such as
`http://192.168.1.42:8080`. Open that printed URL on the second Mac. Do not run
a second server or use `localhost` on the second Mac.

Both Macs must be on the same trusted, non-guest network. Full instructions and
firewall troubleshooting are in [docs/LAN_SETUP.md](docs/LAN_SETUP.md).

If the launcher reports `192.0.0.2` with CLAT/NAT64, the current network is
IPv6-only and does not provide a peer-reachable IPv4 address. Do not force that
address with `--ip`. Connect both Macs to a trusted Wi-Fi or Ethernet network
that gives this host a `10.x`, `192.168.x`, or `172.16-31.x` address, then rerun
the launcher.

Stop the application without deleting its message history:

```bash
docker compose down
```

To remove the local history as well, use `docker compose down -v`. That command
deletes the project's Docker volume and cannot be undone.

## Verify the project

Run all unit, integration and production-build checks inside Docker:

```bash
docker compose --profile test build
docker compose --profile test run --rm backend-test
docker compose --profile test run --rm frontend-test
docker compose --profile test run --rm smoke
```

The end-to-end smoke test reaches the application through Nginx and verifies:

- backend and database health;
- two live WebSocket participants;
- message delivery in both directions;
- sender acknowledgements;
- typing and ping/pong events;
- SQLite message history;
- rejection of a third participant.

See [docs/TESTING.md](docs/TESTING.md) for the complete procedure and
[docs/TEST_RESULTS.md](docs/TEST_RESULTS.md) for the verified handoff results.

## What is included

```text
frontend/              React, TypeScript and Vite interface
backend/               FastAPI, WebSocket and SQLite service
scripts/               Docker end-to-end smoke test
docs/                  API, architecture, requirements and phase status
docker-compose.yml     One-command local stack
```

The browser is served by Nginx on port `8080`. Nginx forwards `/api` and `/ws`
to the private FastAPI container. SQLite data is held in the named Docker
volume `bb84-secure-chat_chat-data`.

## Configuration

Copy `.env.example` to `.env` and change values only when needed.

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_PORT` | `8080` | Host port used by the web interface |
| `BIND_ADDRESS` | `127.0.0.1` | Local-only bind; LAN helper changes it to `0.0.0.0` |
| `DATABASE_PATH` | `/data/chat.db` | SQLite path inside the backend container |
| `ALLOWED_ORIGINS` | localhost origins | Allowed browser WebSocket/HTTP origins |
| `MAX_MESSAGE_LENGTH` | `2000` | Maximum chat message length |
| `HISTORY_LIMIT` | `100` | Maximum history records returned |

If port 8080 is busy, set `APP_PORT=8090` in `.env` and include the matching
origin, such as `http://localhost:8090`, in `ALLOWED_ORIGINS`.

## Local development without Docker

Backend:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
DATABASE_PATH=./data/chat.db ALLOWED_ORIGINS=http://localhost:5173 \
  uvicorn app.main:app --reload
```

Frontend, in a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Vite opens the development interface at `http://localhost:5173` and proxies
API and WebSocket traffic to the backend on port 8000.

## Design decisions

- Rooms are intentionally limited to two distinct live client IDs.
- Browser identities are temporary and are not authenticated accounts.
- Messages are acknowledged with a client-generated ID, which lets the UI
  reconcile optimistic sends with stored records without duplicating them.
- Presence and typing state are ephemeral; message history is durable.
- The current transport contract is kept separate from future BB84 and
  encryption logic so later security work can be evaluated explicitly.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/API.md](docs/API.md), and [SECURITY.md](SECURITY.md) before extending the
project.

## Troubleshooting

- **Docker cannot connect:** start Docker Desktop and wait until its engine is
  ready, then rerun the command.
- **Port already in use:** change `APP_PORT` in `.env` and update
  `ALLOWED_ORIGINS` to match.
- **Room is full:** only two different live client IDs may join a room. Create
  a new room or close one participant's tab.
- **Second Mac cannot connect:** use the host Mac's printed LAN URL, not
  `localhost`; then follow [docs/LAN_SETUP.md](docs/LAN_SETUP.md).
- **Messages remain after restart:** this is expected. They are stored in the
  named Docker volume.
- **Reset local data:** run `docker compose down -v`, understanding that this
  permanently removes the local chat database.

## Source report

The original requirements document is preserved at
[docs/Project_Reference_Secure_Chat.docx](docs/Project_Reference_Secure_Chat.docx).
The implemented boundaries are summarized in
[docs/PHASE_STATUS.md](docs/PHASE_STATUS.md).
