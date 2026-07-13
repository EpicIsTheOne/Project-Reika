#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REIKA_REPO_URL:-https://github.com/EpicIsTheOne/Project-Reika.git}"
INSTALL_DIR="${REIKA_NODE_INSTALL_DIR:-${REIKA_AGENT_INSTALL_DIR:-$HOME/.reika/reika-node}}"
BIN_DIR="${REIKA_NODE_BIN_DIR:-${REIKA_AGENT_BIN_DIR:-$HOME/.local/bin}}"
RELAY_URL=""
PAIRING_CODE=""
DEVICE_ID=""
RUN_AFTER_INSTALL=1
ENABLE_STARTUP=1

usage() {
  cat <<'EOF'
Reika Node Linux CLI installer

Usage:
  curl -fsSL https://raw.githubusercontent.com/EpicIsTheOne/Project-Reika/main/server/scripts/install-linux.sh | bash
  curl -fsSL https://raw.githubusercontent.com/EpicIsTheOne/Project-Reika/main/server/scripts/install-linux.sh | bash -s -- --code <code> --relay <url>

Options:
  --code <code>       Pairing code created in Reika.
  --relay <url>       Relay device WebSocket URL. Defaults to REIKA_RELAY_URL or the bundled server default.
  --device-id <id>    Override the generated device id.
  --install-only      Install the CLI wrapper without starting the agent.
  --no-startup        Do not enable the user-level startup service.
  --help              Show this help.

Installed command:
  reika-node --help
  reika-node pair --code <code> --relay <url>
  reika-node startup status
  reika-node startup enable --relay <url>
  reika-node startup disable

Linux pairing:
  1. Create a pairing code in Reika.
  2. Run this installer with --code and --relay.
  3. The installer enables startup automatically unless --no-startup is passed.
  4. Approve the claimed node in Reika.
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

if [[ -z "$RELAY_URL" && -n "${REIKA_RELAY_URL:-}" ]]; then
  RELAY_URL="$REIKA_RELAY_URL"
fi

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

cat > "$BIN_DIR/reika-node" <<EOF
#!/usr/bin/env bash
cd "$INSTALL_DIR/server"
exec node dist/main.js "\$@"
EOF
chmod +x "$BIN_DIR/reika-node"
ln -sf "$BIN_DIR/reika-node" "$BIN_DIR/reika-agent-server"

echo "Installed reika-node to $BIN_DIR/reika-node"
echo "Legacy reika-agent-server command retained as a compatibility alias."

if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo "Note: add $BIN_DIR to PATH if reika-node is not found in a new terminal."
fi

if [[ "$ENABLE_STARTUP" -eq 1 ]]; then
  startup_args=(startup enable)
  if [[ -n "$RELAY_URL" ]]; then startup_args+=(--relay "$RELAY_URL"); fi
  if [[ -n "$DEVICE_ID" ]]; then startup_args+=(--device-id "$DEVICE_ID"); fi
  if "$BIN_DIR/reika-node" "${startup_args[@]}"; then
    echo "Startup enabled. Use reika-node startup disable to turn it off."
  else
    echo "Startup service could not be enabled automatically. Run reika-node startup enable when systemd --user is available." >&2
  fi
fi

if [[ "$RUN_AFTER_INSTALL" -eq 0 ]]; then
  exit 0
fi

if [[ -n "$PAIRING_CODE" ]]; then
  args=(pair --code "$PAIRING_CODE")
  if [[ -n "$RELAY_URL" ]]; then args+=(--relay "$RELAY_URL"); fi
  if [[ -n "$DEVICE_ID" ]]; then args+=(--device-id "$DEVICE_ID"); fi
  args+=(--no-ui)
  exec "$BIN_DIR/reika-node" "${args[@]}"
fi

"$BIN_DIR/reika-node" --help
