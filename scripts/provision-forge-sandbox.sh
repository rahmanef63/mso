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
# mktemp uses 0700; the imported root must be traversable by sandbox UIDs.
chmod 0755 "$ROOT"
cleanup() {
  find "$ROOT" -type f -delete 2>/dev/null || true
  find "$ROOT" -depth -type d -empty -delete 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM
install -Dm755 "$NODE_BIN" "$ROOT/usr/bin/node"
# ldd output has two useful forms: `name => /abs/path (...)` and `/abs/loader (...)`.
mapfile -t LIBS < <(ldd "$NODE_BIN" | awk '/=> \/[^ ]+/ {print $3} /^[[:space:]]*\/[^ ]+/ {print $1}' | sort -u)
[ "${#LIBS[@]}" -gt 0 ] || { echo "Tool Forge: could not resolve Node shared libraries" >&2; exit 1; }
for lib in "${LIBS[@]}"; do
  [ -f "$lib" ] || { echo "Tool Forge: missing shared library $lib" >&2; exit 1; }
  install -Dm755 "$lib" "$ROOT$lib"
done
mkdir -p "$ROOT/tmp" "$ROOT/workspace"
chmod 1777 "$ROOT/tmp"
# The script sets `umask 077` for the temp dir, and `install -D` inherits it, so the
# image's /usr and /usr/bin end up `drwx------`. A container started with --cap-drop ALL
# has no CAP_DAC_OVERRIDE, so even root cannot traverse a 0700 directory it does not own,
# and `--user <host uid>` cannot either. Both of those failures surfaced as
# "exec: /usr/bin/node: permission denied" and as EACCES on the mounted script. Normalise
# the tree the way a real rootfs is: world-traversable directories, binaries 0755.
find "$ROOT" -type d -exec chmod 0755 {} +
# Directories only. A blanket `chmod 0644` over files would clear the executable bit on
# the loader (lib64/ld-linux) and on every library install put at 0755, which surfaces as
# `exec: /usr/bin/node: permission denied` — the ELF is fine, its interpreter is not. Every
# file in this rootfs is a binary, so 0755 is correct for all of them.
NODE_VERSION="$(node --version)"
# --owner=0 --group=0 is load-bearing, not tidiness. `install` copies as the invoking
# user (uid 1000 here), and a rootfs imported with non-root ownership fails at container
# init with `exec: "/usr/bin/node": permission denied` — the binary is present, executable
# on the host, and still refused by runc. Normalising ownership to root is what makes the
# imported rootfs a valid container image.
tar -C "$ROOT" --owner=0 --group=0 -cf - . | docker import \
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
