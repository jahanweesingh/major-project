# Project Phase Status

## Current implementation

This repository is the first working software slice of the proposed BB84 QKD
chat project. It implements the classical chat foundation only:

- two participants in one room;
- real-time WebSocket message delivery;
- presence and typing events;
- SQLite message history;
- responsive browser interface;
- Docker-based local setup;
- backend, frontend and end-to-end smoke tests.

Messages in this version are not protected by BB84-derived keys and are not
end-to-end encrypted. The interface states this explicitly so the prototype
does not make a false security claim.

## Deliberately not implemented yet

- BB84 state preparation, measurement and basis sifting;
- channel-noise or intercept-resend simulation;
- QBER calculation and accept-or-abort decisions;
- reconciliation, privacy amplification and key confirmation;
- application-key derivation;
- AES-256-GCM message envelopes;
- authenticated user accounts and production TLS termination.

## Planned integration boundary

The current WebSocket service accepts a validated plaintext message event and
stores a message record. A later encrypted-message phase can replace the
plaintext payload with a versioned envelope containing ciphertext, nonce,
authentication tag, sequence number and session context. Room and participant
events can remain unchanged. The BB84 simulator should produce key material
through a separate key-session service so protocol logic does not become mixed
with transport code.

## Safety statement

Use this build for local development, interface evaluation and networking
tests. Do not use it for confidential communication. The word secure in the
project title describes the planned system, not the protection level of this
Phase 1 implementation.

