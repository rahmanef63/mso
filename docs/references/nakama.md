# ahmadrosid/nakama

| | |
|---|---|
| License | MIT, © 2026 ahmadrosid |
| Pin | commit `f6c8f26f8a831e690016ec70429c3cb5cb114cec` |
| Relation | parity contract: 64 requirement groups, 24 packages, 8 stages, 30 acceptance journeys |
| Code copied | none |

## What MSO uses

Concept and behaviour contracts only. The frozen inventory is
[`../parity/nakama-v0.1.json`](../parity/nakama-v0.1.json), the status map is
[`../parity/nakama-implementation.json`](../parity/nakama-implementation.json),
the reference render is [`../NAKAMA-PARITY.md`](../NAKAMA-PARITY.md), and the
release gate rules are [`../parity/EVIDENCE.md`](../parity/EVIDENCE.md).

## What MSO does not use

No source file, string, asset, logo or screenshot. `docs/parity/source-references.json`
records 100 file identities (69 Nakama, 31 MSO) so a reader can re-fetch the exact
bytes that were read. A hash proves which bytes were read, not that a feature works.

## Evidence

- `node scripts/check-nakama-parity.mjs` reports `59 pending, 5 partial, 0 implemented`.
- All 100 recorded SHA-256 values re-verified against both pinned commits: 0 mismatches.
- Shingle comparison of 2,830 MSO files against 1,524 Nakama source files: the only
  overlap above 0.25 is `components/ui/*`, which is shadcn/ui present in MSO's initial
  commit `71a4303` (2026-08-02), before parity work began on 2026-10-18.
- `grep -r nakama lib app frontend` returns nothing outside `scripts/parity/` and docs.

## Local study instance

A Nakama container runs at `127.0.0.1:4310` for comparison. It is not exposed
publicly and `~/.config/systemd/user/cloudflared-nakama.service` is not installed,
so no tunnel is serving it. MIT permits this without asking the author.
