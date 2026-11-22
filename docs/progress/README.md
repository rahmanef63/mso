# Conflict-free per-PR progress notes

To avoid recurring merge conflicts at line 1 of `docs/PROGRESS.md` when multiple branches or PRs are open in parallel, new PRs add one standalone file here:

```text
docs/progress/YYYY-MM-DD-<short-slug>.md
```

- `docs/PROGRESS.md` remains the canonical historical archive for prior entries.
- Each PR owns its own file under `docs/progress/`, so parallel PRs never collide on the same top lines.
- `docs/CHANGELOG.md` is regenerated on `main` during release (`bun run ship`); feature PRs do not need to edit `docs/CHANGELOG.md`.
