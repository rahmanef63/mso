#!/usr/bin/env bash
# Build the Tool Forge Node fixture sandbox from THIS host's already-trusted Node runtime.
# No registry access, package install, curl, or Dockerfile base image is involved.
set -euo pipefail
umask 077
IMAGE="${OS_TOOL_FORGE_NODE_IMAGE:-mso-forge-sandbox:node22-v1}"
NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] && [ -x "$NODE_BIN" ] || { echo "Tool Forge: node is required" >&2; exit 1; }
command -v docker >/dev/null || { echo "Tool Forge: docker is required for executable fixture isolation" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Tool Forge: docker daemon is unavailable to this user" >&2; exit 1; }
NODE_BIN="$(readlink -f "$NODE_BIN")"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/mso-forge-rootfs.XXXXXX")"
cleanup() {
  find "$ROOT" -type f -delete 2>/dev/null || true
  find "$ROOT" -depth -type d -empty -delete 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM
install -Dm755 "$NODE_BIN" "$ROOT/usr/bin/node"
# ldd output has two useful forms: `name => /abs/path (...)` and `/abs/loader (...)`.
mapfile -t LIBS < <(ldd "$NODE_BIN" | awk '/=> \/[^ ]+/ {print $3} /^\s*\/[^ ]+/ {print $1}' | sort -u)
[ "${#LIBS[@]}" -gt 0 ] || { echo "Tool Forge: could not resolve Node shared libraries" >&2; exit 1; }
for lib in "${LIBS[@]}"; do
  [ -f "$lib" ] || { echo "Tool Forge: missing shared library $lib" >&2; exit 1; }
  install -Dm755 "$lib" "$ROOT$lib"
done
mkdir -p "$ROOT/tmp" "$ROOT/workspace"
chmod 1777 "$ROOT/tmp"
NODE_VERSION="$(node --version)"
tar -C "$ROOT" -cf - . | docker import \
  --change 'ENTRYPOINT ["/usr/bin/node"]' \
  --change 'ENV PATH=/usr/bin' \
  --change 'LABEL org.mso.tool-forge.version="1"' \
  --change 'LABEL org.mso.tool-forge.runtime="node"' \
  --change "LABEL org.mso.tool-forge.node-version=\"$NODE_VERSION\"" \
  - "$IMAGE" >/dev/null
ID="$(docker image inspect --format '{{.Id}}' "$IMAGE")"
VERSION="$(docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --entrypoint /usr/bin/node "$IMAGE" --version)"
[ "$VERSION" = "$NODE_VERSION" ] || { echo "Tool Forge: sandbox Node verification failed" >&2; exit 1; }
printf 'Tool Forge sandbox ready: %s\nnode=%s\nimageId=%s\n' "$IMAGE" "$VERSION" "$ID"
trap - EXIT HUP INT TERM
cleanup
