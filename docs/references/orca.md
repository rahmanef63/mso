# stablyai/orca

| | |
|---|---|
| License | MIT |
| Pin | `v1.4.230`, source tarball commit `b2879bd5aaac` |
| Relation | managed IDE runtime and MCP board bridge |
| Code copied | none |

## What MSO uses

Orca's published release artifacts. [`../../scripts/orca/constants.mjs`](../../scripts/orca/constants.mjs)
pins the `.deb` URL and SHA-256, the source tarball URL, and the license and
third-party-notice digests. `scripts/orca/asar-license.mjs` extracts the upstream
LICENSE and THIRD_PARTY_NOTICES from `app.asar` with a bounded, no-follow reader and
checks them against those digests — the upstream notice travels with the installed
runtime instead of being dropped.

`lib/managed-apps/orca-*.ts` and `scripts/orca/` (4,046 lines) are MSO-native
lifecycle, containment, readiness, pairing and receipt code.

## What MSO does not use

No Orca source is vendored, patched, or re-served as MSO code. `docs/ORCA-INTEGRATION.md`
records that the live install remains an explicit operator action and that no real
runtime or browser journey was claimed from fixtures.

## Evidence

`grep -r orcad lib` finds only receipt-path assertions in tests. The systemd unit is
rendered from code-owned values and names this repository's CLI entry point, never a
mutable upstream path. Orca's lack of per-device revocation is documented as an
upstream gap rather than papered over.
