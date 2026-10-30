# TUI parity plan (opencode → mso)

MSO Agent TUI parity program contract. The Status column in the tables below is
the single source of truth for what shipped. Every item names the seam it uses.
An item with no real seam is marked NOT DONE instead of being faked.

## Audit baseline

Measured from source, not from screenshots.

- mso: 30 modules, 3687 lines in `scripts/mso-agent-*.mjs`. Plain ANSI writes. No
  alt-screen (`\x1b[?1049`), no mouse tracking, no panel/scrollbar engine.
- opencode: Bun binary, OpenTUI + Solid renderer. `scrollbox`, `scrollbarOptions`,
  mouse handlers, session tabs, diff viewer, command palette, sounds, OS
  notifications, configurable keybinds.

The renderer gap is the root of most visual gaps. Everything below avoids it
unless a phase explicitly pays for it.

## Phase 0: cheap wins on existing seams

| # | Item | Seam | Status |
|---|---|---|---|
| P0-1 | `/export [ref] [--out f]` in the TUI | `mso session export` (already shipped) | shipped |
| P0-2 | `/share` authenticated temporary link for the transcript | `createTempShare` has NO HTTP creation route, only `GET`/`HEAD` on `/api/v1/temp-share/[id]` | REFUSED (prints the missing seam instead of faking a link) |
| P0-3 | `/compact` manual compaction | `updateAgentSessionHistory` → `compactIfNeeded` (needs a real trigger action, not a client-side lie) | shipped |
| P0-4 | Reasoning surface: per-turn `reasoningTokens` in the transcript and a `/reasoning` toggle | `usage.reasoningTokens` already recorded by provider streams | shipped |
| P0-5 | `/queue [list|clear]` follow-up queue for this session | local queue in session state, reuses `agentRound` | shipped |
| P0-6 | `/theme [dark|light|mono|status]` | `C` palette in `mso-agent-ui.mjs`, honours `NO_COLOR` | shipped |

### Phase 0 shipped evidence
- P0-1 (`/export`): case "/export" in scripts/mso-agent-commands.mjs, tested in scripts/mso-agent-export.test.ts
- P0-2 (`/share`): case "/share" in scripts/mso-agent-commands.mjs, tested in scripts/mso-agent-export.test.ts
- P0-3 (`/compact`): case "/compact" in scripts/mso-agent-commands.mjs, tested in lib/agent/session-compact-force.test.ts
- P0-4 (`/reasoning`): case "/reasoning" in scripts/mso-agent-commands.mjs, tested in scripts/mso-agent-reasoning.test.ts
- P0-5 (`/queue`): case "/queue" in scripts/mso-agent-commands.mjs, tested in scripts/mso-agent-queue.test.ts
- P0-6 (`/theme`): case "/theme" in scripts/mso-agent-commands.mjs, tested in scripts/mso-agent-theme.test.ts

## Phase 1: medium

| # | Item | Seam | Status |
|---|---|---|---|
| P1-1 | Diff viewer panel from artifact revisions | `GET /api/v1/agent-sessions?view=artifact&action_ref=…` already returns `diff.unifiedDiff` | shipped |
| P1-2 | `/stash` prompt stash (20 slots, LIFO pop) | per-process state; `pop` PRINTS the text because the composer has no prefill seam | shipped with stated limit |
| P1-3 | `/diff [action_ref]` binds P1-1 to the last write tool call | session events | shipped |
| P1-4 | `/image <path>` attach a local image to the next prompt | `/api/v1/fs/upload`, block prepended to the next user message then cleared | shipped |
| P1-5 | `/files` read-only file tree of cwd (bounded) | `/api/v1/fs/list` | shipped |

### Phase 1 shipped evidence
- P1-1 (Diff viewer panel): renderer in scripts/mso-agent-diff.mjs, tested in scripts/mso-agent-diff.test.ts
- P1-2 (`/stash`): case "/stash" in scripts/mso-agent-commands.mjs, tested in scripts/mso-agent-stash.test.ts
- P1-3 (`/diff`): case "/diff" in scripts/mso-agent-commands.mjs, tested in scripts/mso-agent-diff.test.ts
- P1-4 (`/image`): case "/image" in scripts/mso-agent-commands.mjs, tested in scripts/mso-agent-image.test.ts
- P1-5 (`/files`): case "/files" in scripts/mso-agent-commands.mjs, tested in scripts/mso-agent-files.test.ts

## Phase 2: large, needs decisions

The renderer half of Phase 2 is planned in detail in
[TUI-RENDERER-PLAN.md](./TUI-RENDERER-PLAN.md), including why the alternate screen
cannot come before a transcript model exists.

| # | Item | Why it is large | Status |
|---|---|---|---|
| P2-1 | Session tabs | Needs alt-screen; without it tabs corrupt scrollback | NOT DONE (deferred) |
| P2-2 | Mouse, panels, scrollbar, split | Requires a retained-mode renderer (OpenTUI/blessed/ink) | NOT DONE (deferred) |
| P2-3 | Configurable keybinds | Keymap loader, conflict detection, `~/.mso/keybinds.json` | DONE (PR #182) |

## Deliberately refused

- Inventing reasoning TEXT. The provider streams expose reasoning token counts,
  not reasoning text. Showing a fake block would be a lie.
- Per-model cost. Not recorded anywhere. The command says so.
- A `/theme` that only recolours half the UI. Either every `C.*` use goes through
  the palette, or the command is not shipped.

## Gate

Same as PR #165: targeted tests, `check-architecture` without raising a ratchet,
`check-docs`, `pr-preflight --local`, `pr-preflight --security`, then a draft PR.
