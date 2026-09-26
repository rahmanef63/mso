# Disaster recovery contract

> **Target and current boundary.** Local server-memory snapshots with checksum/restore rehearsal are useful, but a same-host partial snapshot is not disaster recovery. See [`MEMORY-SAFETY.md`](./MEMORY-SAFETY.md) for current implementation limits.

## Stable launch target

Use a 3-2-1 posture for critical MSO state:

1. **Live copy** on the active installation.
2. **Independent backup copy** that is not the live state tree.
3. **Encrypted offsite/off-host copy** with separate failure domain and access controls.

A backup counts only when its manifest states scope/completeness and a restore drill proves readable content.

## Initial objectives

| Objective | Public-beta target | Stable target |
|---|---:|---:|
| Critical-state RPO | ≤24 h | ≤4 h or explicitly configured |
| Reference-installation RTO | ≤2 h | ≤60 min |
| Restore drill | before beta + after backup format changes | at least monthly and after material storage changes |
| Offsite copy | required | required |
| Encryption | required for credential/private-session-bearing backup | required |

These are product acceptance objectives, not current measured promises.

## Backup set classes

- **Critical identity/config:** enough to reconstruct approved configuration without publishing secrets.
- **Memory/session/workflow evidence:** typed memory, durable session/archive sources, recipes/workflows and project evidence covered by the server-memory backup allowlist.
- **Source/release metadata:** Git remote/source plus exact release/provenance information.
- **External systems:** provider data stays owned by its provider and needs its own backup/export policy; MSO must not pretend a local snapshot covers it.
- **Reinstallable cache/build data:** excluded unless needed for a specific forensic purpose.

## Restore drill

A passing drill starts in an isolated target, verifies backup manifest/checksums, restores without overwriting production, proves representative session/memory/workflow/config reads, records missing/excluded scope, and demonstrates the documented rebuild path to a healthy MSO runtime.

No successful checksum alone proves the snapshot was complete.
