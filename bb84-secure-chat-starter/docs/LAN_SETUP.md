# Chat between two computers on the same network

## The important point

Only **one computer runs the Docker project**. That computer is the host. The other computer opens the host's LAN address in its browser.

If both computers open `http://localhost:8080`, they are talking to two different backends and cannot see each other's messages. `localhost` always means “this computer.”

## Recommended setup

On the host Mac or Linux computer, open Terminal in the project folder and run:

```sh
chmod +x scripts/start_lan.sh
./scripts/start_lan.sh
```

The helper:

- detects the host's private Wi-Fi or Ethernet IPv4 address;
- writes a separate `.env.lan` file without changing `.env`;
- sets `BIND_ADDRESS=0.0.0.0` and binds the website to port `8080`;
- allows browser connections only from localhost and the selected LAN address;
- builds and starts Docker Compose; and
- prints the URL to open on the second computer.

Example output:

```text
Host computer:  http://localhost:8080
Second computer: http://192.168.1.42:8080
```

On the second computer, open the printed `http://192.168.x.x:8080` URL. Both people should enter the same room code. Do not replace that address with `localhost` on the second computer.

If automatic detection chooses the wrong adapter, specify the host's private address:

```sh
./scripts/start_lan.sh --ip 192.168.1.42
```

The accepted address must be from `10.0.0.0/8`, `172.16.0.0/12`, or `192.168.0.0/16`. The helper intentionally rejects public IP addresses.

## If the Mac shows `192.0.0.2`

An address such as `192.0.0.2/32`, together with `CLAT46` or `NAT64`, means the
current network is IPv6-only and macOS is providing a translation address for
outbound IPv4 traffic. It is not a LAN address that the second Mac can open.
The launcher intentionally refuses it instead of starting a server that looks
healthy locally but cannot receive the other person's connection.

Connect both Macs to the same normal, trusted Wi-Fi or Ethernet network. Avoid
guest networks and networks that isolate connected devices. Then check the
host Mac again:

```sh
ipconfig getifaddr en0
```

Continue only when the result begins with `10.`, `192.168.`, or an address from
`172.16.` through `172.31.`. From the project directory, run:

```sh
./scripts/start_lan.sh
```

Do not pass `192.0.0.2` through `--ip`. If an old LAN configuration was used
before the network changed, the next successful run replaces `.env.lan`
automatically. You do not need to edit or delete it.

## Finding the host address manually on macOS

For Wi-Fi, try:

```sh
ipconfig getifaddr en0
```

If the Mac uses Ethernet or a different adapter, open **System Settings → Network**, select the connected service, and copy its IP address. Then pass it with `--ip`.

## Quick diagnosis

Run these checks in order.

1. On the host, confirm Docker is healthy:

   ```sh
   docker compose --env-file .env.lan ps
   curl http://127.0.0.1:8080/api/health
   ```

   The API response should report `"status":"ok"`.

2. On the second computer, replace the example address with the printed join address:

   ```sh
   curl http://192.168.1.42:8080/api/health
   ```

3. If the host check works but the second-computer check fails:

   - verify both computers are on the same Wi-Fi or Ethernet network;
   - disable VPNs temporarily because they can select or route through the wrong adapter;
   - avoid guest Wi-Fi, hotspot isolation, or “client isolation,” which blocks devices from reaching each other;
   - in **macOS System Settings → Network → Firewall → Options**, allow incoming connections for Docker Desktop; and
   - verify no other program is already using port 8080.

4. If the page opens but chat stays disconnected, restart using the helper. A normal `.env` often permits only localhost, so the backend rejects the second browser's WebSocket origin. The generated `.env.lan` includes the exact LAN origin.

5. View service errors if needed:

   ```sh
   docker compose --env-file .env.lan logs --tail=100 backend frontend
   ```

## Stopping the LAN server

From the project folder, run:

```sh
docker compose --env-file .env.lan down
```

This stops the containers but preserves chat history in the Docker volume. To start again after the host's IP address changes, rerun `./scripts/start_lan.sh`; it safely regenerates `.env.lan`.

## Security limitations

This Phase 1 application stores and transports chat messages without end-to-end encryption. BB84, QBER, authentication, TLS, and AES-GCM are not implemented yet.

- Use this mode only on a trusted private development network.
- Do not use it on public Wi-Fi.
- Do not configure router port forwarding for port 8080.
- Stop the stack when the demonstration is finished.
- `ALLOWED_ORIGINS` is a browser-origin check, not user authentication.
