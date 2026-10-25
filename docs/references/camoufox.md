# daijro/camoufox

| | |
|---|---|
| License | MPL-2.0 |
| Pin | release `v156.0.1-beta.36` |
| Relation | managed anti-detect browser runtime behind the split-origin viewer |
| Code copied | none |

## What MSO uses

A downloaded, hash-pinned release archive. [`../../scripts/camoufox-artifact.json`](../../scripts/camoufox-artifact.json)
records the exact URL, archive SHA-256 and installed file-tree digest per
architecture (`x86_64`, `arm64`). Installation verifies before extraction into
private versioned state and re-verifies files, ownership, permissions and
regular-file boundaries before each launch.

`lib/camoufox/` (13 modules) is MSO-native: origin split, session-cookie scope,
viewer gate, transport and path mapping to loopback noVNC. None of it is Camoufox
source.

## MPL-2.0 boundary

MPL is file-level copyleft. MSO does not modify or redistribute Camoufox files;
it downloads an unmodified upstream archive at install time and verifies it. If a
future change patches Camoufox source, those patched files must be published under
MPL-2.0. The browser binary is not committed to this repository.

## Evidence

`grep -r camoufox lib scripts` returns MSO adapters, the artifact pin, and docs only.
The noVNC viewer is served from a reserved split-origin host so third-party
keyboard/mouse access never shares the cockpit origin.
