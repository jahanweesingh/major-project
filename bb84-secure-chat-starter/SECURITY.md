# Security Status

This repository is an academic Phase 1 chat foundation. It is not yet a secure
messenger.

- Messages are relayed and stored as plaintext.
- Participants use temporary client identifiers, not authenticated accounts.
- BB84, QBER, key derivation and AES-GCM are not implemented in this phase.
- Localhost and the optional trusted-LAN mode are intended only for development
  and demonstration.

Do not send confidential information through this build. Before any public or
production deployment, add authenticated identities, TLS, origin restrictions,
abuse controls, encrypted message envelopes, secret management and an explicit
security review.

The LAN helper permits only localhost and the selected private IPv4 Origin, but
that is not authentication or encryption. Never use LAN mode on public Wi-Fi,
never port-forward its HTTP port, and stop the stack after the demonstration.

Report implementation vulnerabilities privately to the project maintainers.
