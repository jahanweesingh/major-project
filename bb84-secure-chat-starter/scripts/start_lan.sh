#!/bin/sh

# Start one shared BB84 Secure Chat Phase 1 server for trusted LAN testing.
# The second computer must open the printed URL; it must not use its own
# localhost instance if both people are meant to share the same room.

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
ENV_FILE="$PROJECT_DIR/.env.lan"
LAN_IP=""
DRY_RUN=0

usage() {
    cat <<'EOF'
Usage: ./scripts/start_lan.sh [--ip PRIVATE_IPV4] [--dry-run]

Options:
  --ip IP       Use this Mac/Linux computer's private LAN IPv4 address.
  --dry-run     Validate and show the configuration without writing or starting.
  -h, --help    Show this help.

Examples:
  ./scripts/start_lan.sh
  ./scripts/start_lan.sh --ip 192.168.1.42
EOF
}

fail() {
    printf 'Error: %s\n' "$*" >&2
    exit 1
}

is_clat_ipv4() {
    candidate=$1
    case "$candidate" in
        ''|*[!0-9.]*) return 1 ;;
    esac

    # 192.0.0.0/29 is reserved for IPv4 service continuity (CLAT). These
    # addresses translate outbound traffic but are not peer-reachable LAN IPs.
    printf '%s\n' "$candidate" | awk -F. '
        NF != 4 { exit 1 }
        $1 == 192 && $2 == 0 && $3 == 0 && $4 >= 0 && $4 <= 7 { exit 0 }
        { exit 1 }
    '
}

is_private_ipv4() {
    candidate=$1
    case "$candidate" in
        ''|*[!0-9.]*) return 1 ;;
    esac

    printf '%s\n' "$candidate" | awk -F. '
        NF != 4 { exit 1 }
        {
            for (i = 1; i <= 4; i++) {
                if ($i == "" || $i < 0 || $i > 255) exit 1
            }
        }
        $1 == 10 { exit 0 }
        $1 == 172 && $2 >= 16 && $2 <= 31 { exit 0 }
        $1 == 192 && $2 == 168 { exit 0 }
        { exit 1 }
    '
}

first_private_from_lines() {
    while IFS= read -r candidate; do
        if is_private_ipv4 "$candidate"; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done
    return 1
}

detect_macos_ip() {
    default_interface=$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')
    if [ -n "${default_interface:-}" ]; then
        candidate=$(ipconfig getifaddr "$default_interface" 2>/dev/null || true)
        if is_private_ipv4 "${candidate:-}"; then
            printf '%s\n' "$candidate"
            return 0
        fi
    fi

    # Ignore loopback, Docker bridges and common VPN tunnel interfaces.
    ifconfig 2>/dev/null | awk '
        /^[[:alnum:]][[:alnum:]_.-]*:/ {
            interface_name=$1
            sub(/:$/, "", interface_name)
        }
        $1 == "inet" && interface_name !~ /^(lo|utun|awdl|llw|bridge|docker|veth)/ {
            print $2
        }
    ' | first_private_from_lines
}

detect_linux_ip() {
    if command -v ip >/dev/null 2>&1; then
        candidate=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '
            {
                for (i = 1; i <= NF; i++) {
                    if ($i == "src" && (i + 1) <= NF) {
                        print $(i + 1)
                        exit
                    }
                }
            }
        ')
        if is_private_ipv4 "${candidate:-}"; then
            printf '%s\n' "$candidate"
            return 0
        fi

        ip -o -4 addr show scope global 2>/dev/null | awk '{split($4, address, "/"); print address[1]}' | first_private_from_lines
        return $?
    fi

    if command -v hostname >/dev/null 2>&1; then
        hostname -I 2>/dev/null | tr ' ' '\n' | first_private_from_lines
        return $?
    fi
    return 1
}

detect_lan_ip() {
    case "$(uname -s)" in
        Darwin) detect_macos_ip ;;
        Linux) detect_linux_ip ;;
        *) return 1 ;;
    esac
}

detected_clat_ipv4() {
    case "$(uname -s)" in
        Darwin)
            # The continuity prefix is reserved for CLAT/NAT64 operation.
            ifconfig 2>/dev/null | awk '
                $1 == "inet" {
                    split($2, octet, ".")
                    if (octet[1] == 192 && octet[2] == 0 && octet[3] == 0 && octet[4] >= 0 && octet[4] <= 7) {
                        print $2
                        exit
                    }
                }
            '
            ;;
        Linux)
            if command -v ip >/dev/null 2>&1; then
                ip -o -4 addr show scope global 2>/dev/null | awk '
                    {
                        split($4, address, "/")
                        split(address[1], octet, ".")
                        if (octet[1] == 192 && octet[2] == 0 && octet[3] == 0 && octet[4] >= 0 && octet[4] <= 7) {
                            print address[1]
                            exit
                        }
                    }
                '
            fi
            ;;
    esac
}

fail_no_lan_address() {
    clat_ip=${1:-}
    if ! is_clat_ipv4 "$clat_ip"; then
        clat_ip=$(detected_clat_ipv4 || true)
    fi
    if is_clat_ipv4 "${clat_ip:-}"; then
        cat >&2 <<EOF
Error: this Mac is on an IPv6-only CLAT/NAT64 network ($clat_ip).

$clat_ip is a translation-only address. The other Mac cannot open it as a
LAN address, and forcing it with --ip will not make chat work.

Fix:
  1. Connect both Macs to the same trusted, non-guest Wi-Fi or Ethernet.
  2. On this Mac, run: ipconfig getifaddr en0
  3. Confirm it shows 10.x, 192.168.x, or 172.16-31.x.
  4. From this project directory, run: ./scripts/start_lan.sh

If an older LAN stack is running, stop it without deleting chat history:
  docker compose --env-file .env.lan down
EOF
        exit 1
    fi

    fail "no peer-reachable private LAN IPv4 was found. Connect both computers to the same trusted Wi-Fi/Ethernet, then retry; use --ip only with this host's 10.x, 192.168.x, or 172.16-31.x address"
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --ip)
            [ "$#" -ge 2 ] || fail "--ip requires a value"
            LAN_IP=$2
            shift 2
            ;;
        --dry-run)
            DRY_RUN=1
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            fail "unknown option '$1'; run with --help"
            ;;
    esac
done

if [ -z "$LAN_IP" ]; then
    LAN_IP=$(detect_lan_ip || true)
fi

if ! is_private_ipv4 "$LAN_IP"; then
    fail_no_lan_address "$LAN_IP"
fi

PORT=8080
BIND_ADDRESS="0.0.0.0"
ALLOWED_ORIGINS="http://localhost:$PORT,http://127.0.0.1:$PORT,http://$LAN_IP:$PORT"
JOIN_URL="http://$LAN_IP:$PORT"

if [ "$DRY_RUN" -eq 1 ]; then
    printf 'LAN configuration is valid.\n'
    printf 'Host bind: %s:%s\n' "$BIND_ADDRESS" "$PORT"
    printf 'Allowed origins: %s\n' "$ALLOWED_ORIGINS"
    printf 'Join URL: %s\n' "$JOIN_URL"
    exit 0
fi

command -v docker >/dev/null 2>&1 || fail "Docker is not installed"
docker compose version >/dev/null 2>&1 || fail "Docker Compose is not available"
docker info >/dev/null 2>&1 || fail "Docker is not running; start Docker Desktop or the Docker service, then retry"

temporary_env="$ENV_FILE.tmp.$$"
trap 'rm -f "$temporary_env"' EXIT HUP INT TERM

cat >"$temporary_env" <<EOF
# Generated by scripts/start_lan.sh. Do not add secrets or commit this file.
BIND_ADDRESS=$BIND_ADDRESS
APP_PORT=$PORT
DATABASE_PATH=/data/chat.db
ALLOWED_ORIGINS=$ALLOWED_ORIGINS
MAX_MESSAGE_LENGTH=2000
HISTORY_LIMIT=100
EOF
mv "$temporary_env" "$ENV_FILE"
trap - EXIT HUP INT TERM

printf 'Starting the shared chat server on %s:%s ...\n' "$BIND_ADDRESS" "$PORT"
cd "$PROJECT_DIR"

# Explicit command-scoped values prevent an exported shell variable or the
# regular .env file from silently overriding this LAN configuration.
BIND_ADDRESS="$BIND_ADDRESS" \
APP_PORT="$PORT" \
DATABASE_PATH=/data/chat.db \
ALLOWED_ORIGINS="$ALLOWED_ORIGINS" \
MAX_MESSAGE_LENGTH=2000 \
HISTORY_LIMIT=100 \
docker compose --env-file "$ENV_FILE" up -d --build

if command -v curl >/dev/null 2>&1; then
    attempt=0
    while [ "$attempt" -lt 30 ]; do
        if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
            break
        fi
        attempt=$((attempt + 1))
        sleep 2
    done
    if [ "$attempt" -ge 30 ]; then
        printf 'Warning: the service did not become healthy within 60 seconds.\n' >&2
        printf 'Run: docker compose --env-file .env.lan ps\n' >&2
        printf 'Run: docker compose --env-file .env.lan logs --tail=100\n' >&2
        exit 1
    fi
fi

printf '\nReady.\n'
printf 'Host computer:  http://localhost:%s\n' "$PORT"
printf 'Second computer: %s\n' "$JOIN_URL"
printf '\nBoth people must use the same room code at this shared address.\n'
printf 'Do not use the second computer%s localhost; that opens a separate server.\n' "'s"
printf 'Stop later with: docker compose --env-file .env.lan down\n'
printf 'LAN help: docs/LAN_SETUP.md\n'
