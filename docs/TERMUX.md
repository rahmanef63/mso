# Install MSO on Android with Termux

> **Supported Android path:** Termux hosts an Ubuntu PRoot environment, and MSO runs inside that normal Linux userspace. The `mso` launcher is still installed into Termux, so normal commands remain `mso`, `mso doctor`, `mso web`, and `mso --continue`.

MSO should not be installed directly into native Android/Termux today. MSO uses Bun plus native Node modules such as `node-pty`; Bun does not currently support Android/Termux as a native target. Ubuntu PRoot avoids the Android libc/platform mismatch and gives MSO the same Linux environment used by the normal installer.

References:

- Termux PRoot-Distro: https://github.com/termux/proot-distro
- Bun Termux/Android support request (closed as not planned): https://github.com/oven-sh/bun/issues/29778

## One-paste install

Run this in Termux:

```bash
apt update && apt full-upgrade -y && \
apt install -y curl ca-certificates proot-distro && \
curl -fsSL https://raw.githubusercontent.com/rahmanef63/mso/main/scripts/install-termux.sh | bash
```

The Termux bootstrap is idempotent. Re-running the same command repairs/upgrades the host packages, reuses the `mso-ubuntu` PRoot environment when it already exists, and runs the normal MSO installer again to update the existing checkout.

The script deliberately does **not** enable YOLO mode.

## What the installer does

1. Runs `apt update` and `apt full-upgrade` in Termux first. This is also the recovery path for partial Termux upgrades where `curl` cannot start because OpenSSL/QUIC libraries no longer match.
2. Installs `curl`, CA certificates, and `proot-distro` in Termux.
3. Creates an Ubuntu 24.04 PRoot named `mso-ubuntu`, or reuses it.
4. Creates a non-root Linux user named `mso` inside the guest.
5. Installs Linux build/runtime prerequisites inside Ubuntu.
6. Runs MSO's canonical `scripts/install.sh` inside Ubuntu with `--no-service --no-onboard`.
7. Installs a small Termux-side launcher at `$PREFIX/bin/mso` that enters the Ubuntu guest automatically.
8. Verifies `mso --version` and `mso -h` before returning success.

The actual MSO installation remains owned by the normal Linux installer. The Termux script is only an Android compatibility/bootstrap layer.

## After installation

Use MSO directly from the normal Termux prompt:

```bash
mso --version
mso doctor
mso
mso web
mso --continue
```

For first-time provider/account setup:

```bash
mso onboard
```

`mso web` is the relevant browser path because a PRoot guest does not provide a normal systemd PID 1. Keep the default loopback bind unless you deliberately configure protected HTTPS access.

## If `curl` is broken before installation

A partial Termux upgrade can leave `curl`, OpenSSL, `libcurl`, or `libngtcp2` out of sync. A typical symptom is:

```text
CANNOT LINK EXECUTABLE "curl": cannot locate symbol "SSL_set_quic_tls_transport_params"
```

Repair the package set with `apt` first:

```bash
apt update
apt full-upgrade -y
apt install --reinstall -y openssl libcurl curl ca-certificates
```

Then verify:

```bash
curl --version
openssl version
```

If repository selection itself is broken, run:

```bash
termux-change-repo
```

Choose a working **Main repository**, then repeat the repair commands.

## Why not native Termux?

Native Termux reports Node's platform as `android`, not `linux`. That distinction matters for packages that publish Linux-only native binaries. It is the same class of problem visible when installing tools such as Codex CLI directly in Termux: the JavaScript wrapper may install while an optional Linux ARM64 binary is skipped because npm sees `android/arm64` rather than `linux/arm64`.

MSO has an additional blocker: Bun currently publishes Linux/macOS/Windows targets, not a supported Android/Termux target. Running MSO in Ubuntu PRoot is therefore the stable default rather than maintaining a growing list of native Android binary workarounds.

## Codex CLI note

Codex CLI is **not required** to install MSO. MSO has its own model/provider integration and onboarding.

If you separately want Codex CLI on Android, prefer installing it inside the same Ubuntu PRoot environment rather than native Termux. Native Termux can hit both binary-platform and authentication/networking issues. There have also been Codex TUI reports specific to Android/Termux environments; if a future Codex version regresses in a foreground terminal, `tmux` inside the Linux guest can be used as a TUI workaround, but it is unrelated to the MSO installer itself.

Do not hardcode a stale `@openai/codex-linux-arm64` version into MSO documentation. If a native workaround is ever needed, the wrapper and platform package versions must match exactly.

## PRoot limitations

This Android installation is optimized for MSO CLI and local browser workspace use. It is not equivalent to a normal VPS:

- no normal systemd service is installed;
- host/service integrations that require systemd may be unavailable;
- long-running Android processes are still subject to Android background/battery policies;
- performance is lower than a native Linux host because PRoot translates filesystem/syscall paths in userspace.

For always-on production hosting, install MSO on a normal Linux VPS and use Termux as the client/operator terminal instead.

## Security

MSO can execute commands as its Linux owner. `mso --yolo` automatically approves write and exec actions for that process. Do not make YOLO the default in shared/untrusted environments.

The Android bootstrap creates passwordless `sudo` only for the dedicated `mso` user **inside the isolated PRoot guest** so the canonical MSO installer can install Linux dependencies without interactive password setup. It does not grant Android root access.

## Troubleshooting

### `No mirror or mirror group selected`

If package operations still reach a working mirror, the warning is informational. If downloads fail, run `termux-change-repo` and select a working Main repository.

### `mso: command not found`

Verify the Termux launcher exists:

```bash
ls -l "$PREFIX/bin/mso"
```

Then rerun the one-paste installer. It recreates the launcher idempotently.

### Inspect the Ubuntu guest

```bash
proot-distro login mso-ubuntu --user mso
```

Inside it:

```bash
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
mso --version
mso doctor
```

### Reset only the Android compatibility environment

Do not remove the PRoot distro as a routine repair: it contains the MSO checkout and private MSO state for that guest. Prefer rerunning the installer. If you intentionally want a destructive fresh start, back up the required MSO state first and consult the PRoot-Distro removal documentation.

## Verification checklist

After installation:

```bash
mso --version
mso doctor
mso -h >/dev/null && echo "MSO CLI OK"
```

Then start an interactive session:

```bash
mso
```

For the browser workspace:

```bash
mso web
```

The install is considered healthy when the Termux launcher enters the Ubuntu guest, the MSO CLI resolves there, and `mso doctor` reports no unexpected runtime failure beyond capabilities intentionally unavailable without systemd.
