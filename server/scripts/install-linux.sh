#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REIKA_REPO_URL:-https://github.com/EpicIsTheOne/Project-Reika.git}"
INSTALL_DIR="${REIKA_AGENT_INSTALL_DIR:-$HOME/.agenthub/reika-agent-server}"
BIN_DIR="${REIKA_AGENT_BIN_DIR:-$HOME/.local/bin}"
RELAY_URL=""
PAIRING_CODE=""
DEVICE_ID=""
RUN_AFTER_INSTALL=1
ENABLE_STARTUP=1

usage() {
  cat <<'EOF'
Project Reika Agent Server Linux CLI installer

Usage:
  curl -fsSL https://raw.githubusercontent.com/EpicIsTheOne/Project-Reika/main/server/scripts/install-linux.sh | bash
  curl -fsSL https://raw.githubusercontent.com/EpicIsTheOne/Project-Reika/main/server/scripts/install-linux.sh | bash -s -- --code <code> --relay <url>

Options:
  --code <code>       Pairing code created in AgentHub.
  --relay <url>       Relay device WebSocket URL, for example ws://127.0.0.1:8790/v1/device.
  --device-id <id>    Override the generated device id.
  --install-only      Install the CLI wrapper without starting the agent.
  --no-startup        Do not enable the user-level startup service.
  --help              Show this help.

Installed command:
  reika-agent-server --help
  reika-agent-server pair --code <code> --relay <url>
  reika-agent-server startup status
  reika-agent-server startup enable --relay <url>
  reika-agent-server startup disable

Linux pairing:
  1. Create a pairing code in AgentHub.
  2. Run this installer with --code and --relay.
  3. The installer enables startup automatically unless --no-startup is passed.
  4. Approve the claimed device in AgentHub.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --code|--pairing-code)
      PAIRING_CODE="${2:-}"
      shift 2
      ;;
    --relay|--relay-url)
      RELAY_URL="${2:-}"
      shift 2
      ;;
    --device-id)
      DEVICE_ID="${2:-}"
      shift 2
      ;;
    --install-only)
      RUN_AFTER_INSTALL=0
      shift
      ;;
    --no-startup)
      ENABLE_STARTUP=0
      shift
      ;;
    --help|-h|help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

need_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need_command git
need_command npm
need_command node

mkdir -p "$INSTALL_DIR" "$BIN_DIR"

if [[ -d "$INSTALL_DIR/.git" ]]; then
  git -C "$INSTALL_DIR" pull --ff-only
else
  rm -rf "$INSTALL_DIR"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR/server"
npm ci
npm run build

cat > "$BIN_DIR/reika-agent-server" <<EOF
#!/usr/bin/env bash
cd "$INSTALL_DIR/server"
exec node dist/main.js "\$@"
EOF
chmod +x "$BIN_DIR/reika-agent-server"

echo "Installed reika-agent-server to $BIN_DIR/reika-agent-server"

if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo "Note: add $BIN_DIR to PATH if reika-agent-server is not found in a new terminal."
fi

if [[ "$ENABLE_STARTUP" -eq 1 ]]; then
  startup_args=(startup enable)
  if [[ -n "$RELAY_URL" ]]; then startup_args+=(--relay "$RELAY_URL"); fi
  if [[ -n "$DEVICE_ID" ]]; then startup_args+=(--device-id "$DEVICE_ID"); fi
  if "$BIN_DIR/reika-agent-server" "${startup_args[@]}"; then
    echo "Startup enabled. Use reika-agent-server startup disable to turn it off."
  else
    echo "Startup service could not be enabled automatically. Run reika-agent-server startup enable when systemd --user is available." >&2
  fi
fi

if [[ "$RUN_AFTER_INSTALL" -eq 0 ]]; then
  exit 0
fi

if [[ -n "$PAIRING_CODE" ]]; then
  args=(pair --code "$PAIRING_CODE")
  if [[ -n "$RELAY_URL" ]]; then args+=(--relay "$RELAY_URL"); fi
  if [[ -n "$DEVICE_ID" ]]; then args+=(--device-id "$DEVICE_ID"); fi
  exec "$BIN_DIR/reika-agent-server" "${args[@]}"
fi

"$BIN_DIR/reika-agent-server" --help
