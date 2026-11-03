# Frontend agent instructions

Root `AGENTS.md` and `CLAUDE.md` remain authoritative. Before editing any frontend surface,
read [the frontend implementation contract](../docs/FRONTEND-CONTRACT.md),
[DESIGN.md](../DESIGN.md) and the affected shell/feature contracts linked there.

Apply the shared shell → feature → UI-kit ownership, state lifetime, responsiveness,
accessibility and verification rules. Do not treat Integrations as the only consumer or claim
all features are complete from one panel's evidence. Whole-product work requires a result
and limit for every catalog feature. The same contract covers native DOM UI in `lib/`.
