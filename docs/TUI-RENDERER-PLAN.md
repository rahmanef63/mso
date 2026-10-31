# TUI retained-renderer plan

Research only. No product code was changed to produce this document. Worktree
`research/tui-renderer`, branch of the same name.

Scope: can `mso agent` (launched from `scripts/mso-cli-agent.sh`, implemented in
`scripts/mso-agent-*.mjs`) become a retained-mode renderer with panels, session
tabs, mouse support, a scrollbar and split panes, without breaking the repository
gates? The reference UI is opencode (OpenTUI + Solid). A dependency is not
automatically allowed, so the dependency question is answered against the gates
rather than against taste.

Related documents already in the tree: [TUI-PARITY-PLAN.md](./TUI-PARITY-PLAN.md)
(per-command parity status, Phase 2 items P2-1..P2-3), [ARCHITECTURE.md](./ARCHITECTURE.md),
[DEVELOPMENT.md](./DEVELOPMENT.md) (dependency update policy),
[PLATFORMS.md](./PLATFORMS.md) (macOS/Windows/Android run inside a Linux guest),
[WORKSPACE-GUIDE.md](./reference/WORKSPACE-GUIDE.md) (the documented key map).

## 0. Method and evidence rules

Measured from source, not from screenshots:

- read every `scripts/mso-agent-*.mjs` that writes to the terminal, plus
  `scripts/mso-agent.mjs`, `scripts/mso-cli-agent.sh`, `scripts/mso-tui-select.mjs`
  and the other in-repo TUI (`scripts/integrations-tui/*`,
  `scripts/mso-cli-integrations-tui.sh`);
- ran `node scripts/check-architecture.mjs` (read only);
- ran `eslint` with a probe `max-lines` rule on the largest agent modules to get
  the exact code-line counts the lint gate uses;
- read the gate definitions (`scripts/gates-12.sh`, `scripts/gates.sh`,
  `.github/workflows/ci.yml`, `.github/workflows/dependency-review.yml`);
- did not run the full gate suite, did not deploy, did not touch the live service
  on :4005.

Package facts (licence, engines, size, dependency lists) come from npm registry
metadata fetched while writing this. Anything about how a candidate library
behaves inside this repository is marked unverified.

## 1. What the TUI is today

### 1.1 Shape of the program

`mso agent` is a line-oriented, append-only program with no retained frame.

| Property | Today | Evidence |
|---|---|---|
| Render model | append-only writes; no frame buffer, no cell grid, no previous-frame diff | 100 `console.log` sites and 7 `process.stdout.write` sites across 15 modules (section 1.2); no module holds rendered lines |
| Alternate screen | never entered by the agent | grep for `[?1049` finds only the Integrations wrapper, `scripts/mso-cli-integrations-tui.sh:12-13` |
| Mouse | never enabled | no `[?100x` sequence anywhere under `scripts/` |
| Bracketed paste | never enabled | no `[?2004` sequence anywhere under `scripts/` |
| Scrollbar | none | no viewport model over a transcript; the only scrolling primitive is `windowFor` in `scripts/integrations-tui/layout.mjs:60-66`, used by the Integrations column browser |
| Split panes | none in the agent | `paneWidths`/`border`/`paneRow` exist only in `scripts/integrations-tui/layout.mjs:35-51` |
| Resize handling | composer only | `output.on("resize", onResize)` at `scripts/mso-agent-composer.mjs:204`, handler at `:127`; banner and already-printed sections never reflow |
| TTY requirement | hard requirement for interactive mode | `scripts/mso-agent.mjs:60-62` exits 2 when stdin or stdout is not a TTY |
| Process handoff | launcher `exec`s node, so node owns the terminal | `scripts/mso-cli-agent.sh:397-399` |

The last row matters for every option: because the shell replaces itself with
`exec`, a bash `trap` cannot restore the terminal after node exits. The Integrations
TUI can use `trap 'integration_alt_off' EXIT INT TERM`
(`scripts/mso-cli-integrations-tui.sh:39`) only because its wrapper stays alive and
re-runs a node child per keystroke (`:42`, `:50`). The agent TUI cannot copy that
without dropping `exec`, or without doing teardown inside node.

### 1.2 Where it writes, and how

Seven distinct mechanisms, in order of how much they constrain a rewrite:

1. `console.log` (implicit `\n`, stdout): 100 call sites. `console.error`: 8 call
   sites (stderr: `scripts/mso-agent-cmd-parity.mjs:49,58`,
   `scripts/mso-agent-cmd-session.mjs:74,90`, `scripts/mso-agent-commands.mjs:27`,
   `scripts/mso-agent-mentions.mjs:112`, `scripts/mso-agent.mjs:61,203`).
2. Bare `process.stdout.write`: 7 call sites. Streamed model text goes straight to
   stdout (`scripts/mso-agent-turn.mjs:30`, called from `:138`), including the
   trailing newline (`scripts/mso-agent-runtime.mjs:165`) and each SSE delta
   (`:150`). One-shot output uses `process.stdout.write` too
   (`scripts/mso-agent.mjs:50-51,57`).
3. Raw ANSI constants: erase-to-end-of-line `\x1b[2K`
   (`scripts/mso-agent-activity.mjs:17`), and the composer's cursor kit
   `\x1b[2K`, `\x1b[nA`, `\x1b[nB`, `\x1b[nC`, `\x1b[2J\x1b[H`
   (`scripts/mso-agent-composer-ui.mjs:3-7`).
4. The `\r` plus clear live-row trick: one row repainted in place for the whole
   turn (`scripts/mso-agent-activity.mjs:196`, `:164`), driven by a 120 ms ticker
   (`:16`, `:203-211`).
5. Reserved-row allocation and erase: `reserveComposerRows` writes `"\r\n"` to
   physically claim rows, then moves the cursor back up
   (`scripts/mso-agent-composer-ui.mjs:13-19`); `eraseComposerRows` clears them
   (`:21-25`).
6. Full-screen clear on Ctrl+L: `CLEAR_SCREEN` at `scripts/mso-agent-composer.mjs:135`.
7. Terminal geometry reads: 20 call sites in 11 modules. `scripts/mso-agent-layout.mjs:17`,
   `scripts/mso-agent-ui.mjs:88`, `scripts/mso-agent-diff.mjs:7,146-147`,
   `scripts/mso-agent-files.mjs:148-149`, `scripts/mso-agent-todos.mjs:106`,
   `scripts/mso-agent-composer.mjs:44,47,49,171`,
   `scripts/mso-agent-local-commands.mjs:58,75`, `scripts/mso-agent-mentions.mjs:108,113`,
   `scripts/mso-agent-local.mjs:219`, `scripts/mso-agent.mjs:147-148`.

Sections are printed, never stored: one `Assistant` divider per streamed answer
(`scripts/mso-agent-turn.mjs:20-33`, `:138`), one `Agent work` divider per turn
(`:160-163`), `Local agent` blocks through `sectionBlock`
(`scripts/mso-agent-local.mjs:218-220`), `Error` sections in
`renderInteractionFailure` (`scripts/mso-agent-turn.mjs:189-194`).

### 1.3 Files that write, ranked by size

"Physical" is `split("\n").length`, the ruler `check-architecture` uses
(`scripts/check-architecture.mjs:20-22`). "Code" is the count the `max-lines` lint
rule sees with `skipBlankLines` and `skipComments` (measured with a probe run).

| Module | Physical | Code | Write sites | Direct writes |
|---|---|---|---|---|
| `mso-agent-activity.mjs` | 220 | 156 | 1 | `output.write` only, `:164,196` |
| `mso-agent-turn.mjs` | 217 | 203 | 8 | stdout stream + sections |
| `mso-agent.mjs` | 204 | 183 | 8 | one-shot, exit line, unknown command |
| `mso-agent-ui.mjs` | 194 | 180 | 10 | the banner, `:145-192` |
| `mso-agent-cmd-parity.mjs` | 167 | 161 | 27 | command chatter |
| `mso-agent-skills.mjs` | 154 | 131 | 7 | skill list |
| `mso-agent-status.mjs` | 152 | 136 | 16 | `/status` |
| `mso-agent-commands.mjs` | 123 | 104 | 3 | skill queued, runCli error |
| `mso-agent-session-ui.mjs` | 119 | 105 | 3 | new/resumed lines |
| `mso-agent-mentions.mjs` | 118 | 110 | 2 | local-agent section |
| `mso-agent-cmd-session.mjs` | 113 | 110 | 12 | `/todo`, `/rename`, `/compact` |
| `mso-agent-local-commands.mjs` | 111 | 105 | 11 | `/agents`, `/inbox` |
| `mso-agent-cmd-inspect.mjs` | 98 | 96 | 5 | `/permission`, `/tools` |
| `mso-agent-help.mjs` | 59 | 56 | 1 | `/help` |
| `mso-agent-subagent.mjs` | 40 | 36 | 1 | `/spawn` |

Two more modules write indirectly and are easy to miss:
`scripts/mso-agent-diff.mjs:84-100` returns a string that callers print, and
`scripts/mso-agent-edit-diff.mjs:116-127` / `scripts/mso-agent-todos.mjs:179-190`
print through an injectable `print` sink. `scripts/mso-agent-local.mjs` never calls
`console.log`; it pushes text through `composer.notify` (`:218`), which is the one
existing "write above the draft" seam (`scripts/mso-agent-composer.mjs:93-106`).

Total: 15 modules write directly, 115 direct call sites (100 `console.log`,
8 `console.error`, 7 `process.stdout.write`).

### 1.4 Input handling

One keypress machinery is reused everywhere:

- `readline.emitKeypressEvents(input)` in `scripts/mso-agent-composer.mjs:20` and
  `scripts/mso-tui-select.mjs:114`. The agent never uses `readline.createInterface`,
  and never uses `readline.question`; `AgentComposer.question` is a hand-written
  promise (`scripts/mso-agent-composer.mjs:23-211`) that installs its own listener
  (`:203`) and resolves on submit, cancel or EOF.
- `rl.question` call sites that go through that hand-written prompt:
  `scripts/mso-agent-session-ui.mjs:87` (session picker),
  `scripts/mso-agent-approval-ui.mjs:60,68` (approval),
  `scripts/mso-agent-cmd-inspect.mjs:30` (picker).
- Raw mode is entered in three places: `scripts/mso-agent-composer.mjs:206`,
  `scripts/mso-tui-select.mjs:176`, `scripts/integrations-tui/app.mjs` (the finder's
  `run`, `input.setRawMode(true)`).

Every hardcoded key, so the remaining work is countable. Line numbers in this table
are `scripts/mso-agent-composer.mjs` unless a module is named:

| Key | Action | Line |
|---|---|---|
| Ctrl+C | clear non-empty draft, else cancel prompt | `mso-agent-composer.mjs:130-133` |
| Ctrl+L | clear screen and repaint | `:134-136` |
| Esc | dismiss completion, or cancel when `escapeCancels` | `:137-140` |
| Up / Down (completion open) | move selection | `:141-144` |
| Tab (completion open) | apply completion, or submit when `selectOnEnter` | `:145-151` |
| Tab (empty draft) | `onTab`, permission cycle | `:152-156` |
| Enter / Return | submit, or apply exact match | `:157-168` |
| Up / Down (wrapped draft) | move cursor across visual rows | `:169-174` |
| Up / Ctrl+P | history back | `:175` |
| Down / Ctrl+N | history forward | `:176` |
| Ctrl+D | delete right, or EOF on empty | `:178-182` |
| Ctrl+Left, Alt+Left, Alt+B | word left | `:183` |
| Ctrl+Right, Alt+Right, Alt+F | word right | `:184` |
| Left / Ctrl+B | char left | `:185` |
| Right / Ctrl+F | char right | `:186` |
| Home / Ctrl+A | line start | `:187` |
| End / Ctrl+E | line end | `:188` |
| Backspace | delete left | `:189` |
| Delete | delete right | `:190` |
| Ctrl+W | delete previous word | `:191-194` |
| Ctrl+U | delete to start | `:195` |
| Ctrl+K | delete to end | `:196` |
| printable | insert | `:197-200` |
| SIGINT | interrupt turn, second press exits within 2000 ms | `scripts/mso-agent.mjs:123-131`, `scripts/mso-agent-interrupt.mjs:45-64` |

That is 23 semantic bindings (35 key combinations once alternates are counted separately). The permission selector is not
key-driven: approval is typed text, `allow` or `deny`
(`scripts/mso-agent-approval-ui.mjs:68`). The pickers add 10 more bindings
(`scripts/mso-tui-select.mjs:159-172`): Ctrl+C, Esc, Up, Down, Home, End,
Enter/Return, Backspace, Ctrl+U, printable filter.

Raw-mode restoration:

- Normal paths restore the previous state, not a hardcoded false:
  `wasRaw` is captured at `scripts/mso-agent-composer.mjs:32` and restored in
  `cleanup()` at `:68`; `finish`/`cancel` call `cleanup` (`:71-92`).
  `AgentComposer.close()` forces false (`:230-234`) and the main loop calls it in
  `finally` (`scripts/mso-agent.mjs:188-195`).
- Error paths before raw mode is entered are safe (session bootstrap at
  `scripts/mso-agent.mjs:70-71` precedes the first `question`).
- Error paths after raw mode is entered: the top-level catch (`:203`) runs after the
  `finally` has closed the composer, so raw is restored.
- Gap: no `SIGHUP`, `SIGTERM` or `SIGQUIT` handler exists. Only `SIGINT` is
  registered (`scripts/mso-agent.mjs:131`). A terminated terminal or a killed
  process leaves raw mode on.
- Gap: `scripts/mso-tui-select.mjs` restores raw mode in `cleanup` (`:142-147`) but
  its top-level catch exits without calling it (`:181-184`), so a throw leaves the
  invoking shell in raw mode.

### 1.5 Scrollback: what an alternate screen would destroy

Nothing in the code reads the terminal scroll buffer (that is impossible from a
program), so no code depends on it. The user experience does: the transcript exists
only there.

Printed once and never re-rendered:

- the 12-row ASCII banner plus the panel body, up to about 20 more rows
  (`scripts/mso-agent-ui.mjs:139-193`; 10 `console.log` calls at `:145-192`);
- every streamed assistant token (`scripts/mso-agent-turn.mjs:28-30`);
- section dividers and tool receipts (`scripts/mso-agent-turn.mjs:160-163`,
  `scripts/mso-agent-activity.mjs:119-150` when not animating);
- edit diffs and todo blocks (`scripts/mso-agent-edit-diff.mjs:116-127`,
  `scripts/mso-agent-todos.mjs:179-190`);
- error sections (`scripts/mso-agent-turn.mjs:189-194`);
- every slash-command result (section 1.3);
- the exit line with the resume hint (`scripts/mso-agent.mjs:191-192`).

Critically, history is never replayed. `--continue` and `/resume` replace the
session object (`scripts/mso-agent-session-ui.mjs:39-52,65-82`) and print one
`resumed ... N history rows` line (`:80`), but no module iterates `session.history`
to re-render rows (grep for `for (const ... of session.history` and for a history
printer returns nothing). `printAgentBanner` receives `agentSession` but reads only
`title` and `name` (`scripts/mso-agent-ui.mjs:155-157`). So today the transcript is
literally the scrollback; after `/resume` the user sees the banner and a blank
screen.

Tests and docs treat "no scrollback growth on repaint" as a contract, which is the
closest thing to a code dependency:

- `scripts/mso-agent-composer.test.ts:54,60`, `scripts/mso-agent-composer-session.test.ts:76`
  assert redraw chunks contain no `\n`;
- `scripts/mso-agent-activity.test.ts:48` asserts the live frame contains no `\n`;
- [WORKSPACE-GUIDE.md](./reference/WORKSPACE-GUIDE.md):235 documents "Tab ... cycles
  that footer in place without adding scrollback";
- `docs/PROGRESS.md:2649,2713,2744` record three separate ships whose acceptance
  criterion was zero added scrollback rows. The live PTY regression those entries
  mention is not present in the tree now (only
  `scripts/mso-integrations-finder-pty.test.ts` uses a real PTY), so that claim is
  unverified here.

### 1.6 Retained state that already exists

The program does hold state; it just never renders from it.

| State | Where | Rendered? |
|---|---|---|
| `session` object (history, usage, permission, queue) | `scripts/mso-agent.mjs:73-83` | no, only derived strings |
| composer draft, cursor, history (max 100) | `scripts/mso-agent-composer.mjs:16-18,77-80` | yes, one row block |
| live activity row | `scripts/mso-agent-activity.mjs:22,87-94` | yes, one row |
| cached todos | `scripts/mso-agent-todos.mjs:6,82-94` | only as a status chip |
| local-agent bridge state | `scripts/mso-agent-local.mjs:84-97` | no |

## 2. Dependency policy: is a TUI library allowed?

Plain answer: no gate forbids adding a dependency, and no gate would catch a broken
one. The nearest thing to a policy is
[DEVELOPMENT.md](./DEVELOPMENT.md):169-180 (dependency updates must pass `Verify`,
security scans alone are not enough) and `docs/DEVELOPMENT.md:234` (a dependency
with an install script must be added to `trustedDependencies`, precedent:
`package.json:107-109`).

Gate by gate, for a TUI dependency:

| Gate (`scripts/gates-12.sh`) | Definition | Effect on a TUI dependency |
|---|---|---|
| `typecheck` | `tsc --noEmit`, `scripts/gates-12.sh:33`; `tsconfig.json` includes only `**/*.ts` and `**/*.tsx` | none: `.mjs` is never typechecked |
| `lint` | `eslint . --max-warnings=0`, `:34`; `max-lines` warn at 220 code lines, `eslint.config.mjs:32-35` | applies to every new module; a warning is fatal |
| `installer syntax` | `bash -n scripts/install.sh && bash -n scripts/install-core.sh`, `:35` | none unless the installer is edited |
| `native dependency` | `node -e "require('node-pty')"`, `:36` | none: hardcoded to node-pty, it does not test a new addon. A broken new native addon installs and fails at runtime |
| `cycles` | `scripts/check-cycles.mjs`, `:37`, scans `frontend` and `lib` only, `.ts`/`.tsx` | none: `scripts/` is not in the cycle graph |
| `architecture` | `:38`, see section 3 | applies to new files and their physical length |
| `docs` | `:39`, `scripts/check-docs.mjs` | applies to this document (section 8, M0): every top-level `docs/*.md` must be classified in `docs/README.md` (`scripts/check-docs.mjs:56-63`) |
| `changelog` | `node scripts/gen-changelog.mjs --check`, `:40` | every commit must regenerate `docs/CHANGELOG.md` |
| `contrast` | `:41`, `scripts/check-contrast.mjs` | none: it reads `app/globals.css` and the preset registry only (`scripts/check-contrast.mjs:2-18`); the terminal palette in `scripts/mso-agent-theme.mjs:12-28` is not contrast-checked |
| `bundle budget` | `:42`, `scripts/check-bundle.mjs` -> `scripts/lib/bundle-report.mjs:17-24` | none: it measures only `.next` client chunks for `/[[...slug]]/page`; nothing under `scripts/` is measured |
| `instance guard`, `audit strict`, `ci contract` | `:43-45` | audit applies: `audit.mjs --strict` fails closed on high/critical |
| `tests` / `tests + coverage` | `:51` / `:53` | applies; coverage thresholds are only in `full` |

Outside the local runner:

- `.github/workflows/ci.yml:38` installs with `bun install --frozen-lockfile`, so
  `bun.lock` and `package.json` must move together.
- `.github/workflows/ci.yml:65-71` runs `audit:strict`, `bun audit --audit-level=high`
  and `npm audit --prefix scripts/install/node-gyp`.
- `.github/workflows/dependency-review.yml` fails a PR on `high` severity only.
- `scripts/gates.sh:48` runs `bun run verify` on pre-push, which includes coverage,
  the full test suite, parity checks and an out-of-tree build.

So the honest statement is: a pure-JS TUI dependency would not fail a named gate by
itself. It would add install and supply-chain surface that no gate in this repo
tests, and it would still have to be split into `<= 220`-line modules to satisfy
`architecture`.

Candidate check (registry metadata, fetched while writing):

| Candidate | Licence | Engines | Size | Dependencies | Fit |
|---|---|---|---|---|---|
| `@opentui/core` 0.8.0 | MIT | `node >= 26.4.0`, `bun >= 1.3.14` | 18,054,741 B unpacked | 4 runtime deps plus 8 platform native packages (`@opentui/core-linux-x64` 5,238,581 B, and 7 siblings) | blocked: `package.json:6-9` supports Node `^22.12.0 || ^24.0.0 || >=26.0.0`, so two of the three supported lines are outside the engine range. Native per-platform payload also collides with `bun install` on Termux/PRoot (`docs/PLATFORMS.md:12-14,79-85`) |
| `ink` 8.0.0 | MIT | `node >= 22` | 619,872 B unpacked | 23 runtime deps, including `yoga-layout ~3.2.1` (WASM), `patch-console`, `react-reconciler`; peer `react >= 19.3.0` (repo has 19.3.1, `package.json:97`) | installable; the real cost is architectural, not licence (section 6, Option B) |
| `blessed` 0.1.81 | MIT | `node >= 0.8.0` | small | none declared | not viable: last published with an npm 2 era toolchain, no maintenance signal, no TypeScript or modern terminal story |

Licence itself is not an obstacle for either MIT candidate: the repository is
PolyForm Noncommercial (`LICENSE:1`) and no licence policy exists in `scripts/audit.mjs`
(a grep for `license` returns nothing). That is a repository observation, not legal
advice.

## 3. Ratchet and gate exposure

`node scripts/check-architecture.mjs` on this worktree:

```
filesOver220                 43 / max   43 PASS
filesOver500                  0 / max    0 PASS
cliEntrypointLines          212 / max  220 PASS
installerCoreLines          450 / max  450 PASS
```

Consequences, in order of how much they constrain the design:

1. `filesOver220` is full. `architecture.boundaries.json:6` sets the ceiling and the
   policy note says ratchets may only stay equal or decrease. **Adding one module
   with more than 220 physical lines fails the `architecture` gate immediately.**
2. The scan includes `scripts/**` with `.mjs`, `.js`, `.sh`, `.ts`, `.tsx`
   (`scripts/check-architecture.mjs:18`). It counts physical lines
   (`:20-22`), so comments and blank lines count. `eslint` counts differently
   (`skipBlankLines: true, skipComments: true`, `eslint.config.mjs:35`). Two rulers,
   both fatal.
3. `bin/mso` is at 212 against a 220 ceiling (`check-architecture.mjs:47`,
   `architecture.boundaries.json:16`), and `scripts/install-core.sh` is at 450 of
   450. Neither can grow.

Per-module headroom for the files a renderer change would touch:

| Module | Physical | Physical headroom to 220 | Code (lint) | Code headroom |
|---|---|---|---|---|
| `mso-agent-activity.mjs` | 220 | **0** | 156 | 64 |
| `mso-agent-composer.mjs` | 236 | already over (counted) | 219 | **1** |
| `mso-agent-local.mjs` | 243 | already over (counted) | 220 | **0** |
| `mso-agent-turn.mjs` | 217 | 3 | 203 | 17 |
| `mso-agent.mjs` | 204 | 16 | 183 | 37 |
| `mso-agent-ui.mjs` | 194 | 26 | 180 | 40 |
| `mso-agent-todos.mjs` | 191 | 29 | 135 | 85 |
| `mso-agent-diff.mjs` | 156 | 64 | 142 | 78 |
| `mso-agent-status.mjs` | 152 | 68 | 136 | 84 |
| `mso-agent-composer-ui.mjs` | 114 | 106 | 105 | 115 |
| `mso-agent-layout.mjs` | 65 | 155 | 55 | 165 |

Read that table as a hard plan input:

- `mso-agent-activity.mjs` cannot gain a single line, not even a comment, without
  failing `architecture`. Any new activity behaviour must first remove lines from it.
- `mso-agent-composer.mjs` has exactly one code line of lint headroom; a rewrite that
  adds code there must also move code out of it.
- `mso-agent-local.mjs` has zero lint headroom and is already counted, so it may
  neither gain code nor needs to lose physical lines.
- New modules are fine as long as each stays at or under 220 physical lines, and the
  natural renderer is bigger than that. Splitting is mandatory, not stylistic.

Gate runner modes:

- `scripts/gates-12.sh fast` runs 14 checks: 13 deterministic (`:33-45`) plus
  `vitest run` (`:53`), with coverage explicitly skipped (`:55`).
- `scripts/gates-12.sh full` runs 17: the same 14 with `bun run coverage` (`:51`),
  plus forge sandbox (`:60`), out-of-tree production build (`:62`), perf gate (`:63`).
- `.github/workflows/ci.yml` verify job has 22 steps, adding a second Bun-native
  audit, an npm audit of the native build tool, and 5 browser/perf steps (`ci.yml:84-96`).
- `scripts/gates.sh` (pre-push) is separate and heavier: `bun run verify` (`:48`),
  then cycles, docs, changelog, contrast (`:53-59`), strict audit (`:64`), and an
  out-of-tree build with release journeys (`:70`).

## 4. Existing seams that help

| Seam | File:line | Survives a renderer change? |
|---|---|---|
| `fit`, `pad`, `width` (ANSI-stripping) | `scripts/mso-agent-ui.mjs:73-85` | partly: `fit` strips SGR (`:73`), so it cannot measure styled cells; usable for plain text only |
| `cellWidth`, `fitCells`, `stripAnsi`, `clean` (wide-char aware) | `scripts/integrations-tui/layout.mjs:1-33` | yes, and it is the correct primitive for a frame writer; currently private to the Integrations TUI |
| `paneWidths`, `border`, `paneRow`, `compose`, `windowFor` | `scripts/integrations-tui/layout.mjs:35-66` | yes: vertical splits, borders and scroll windows for free |
| `sectionDivider`, `sectionBlock`, `printSection` | `scripts/mso-agent-layout.mjs:20-42` | yes as pure string producers; their role shrinks to inline mode and to the transcript view |
| `composerPrompt`, `composerFooter`, `composerSeparator` | `scripts/mso-agent-layout.mjs:44-64` | yes, pure; feed the chrome/footer rows |
| `statusParts` (one array of short status strings) | `scripts/mso-agent-status.mjs:62-88` | yes, ideal for a fixed footer or tab metadata |
| `todoStatusChip` | `scripts/mso-agent-todos.mjs:154-174` | yes, plain string |
| `formatDiffBody`, `colorizeDiffLine`, `renderDiff` | `scripts/mso-agent-diff.mjs:12-100` | yes, all return strings; `renderDiff` returns a block, not a print |
| `formatEditDiff` | `scripts/mso-agent-edit-diff.mjs:61-99` | yes, pure string |
| `formatTodoBlock` | `scripts/mso-agent-todos.mjs:101-149` | yes, pure string, already column-aware (`:106`) |
| `inputLayout`, `inputViewport`, `verticalCursor`, `completionWindow`, `menuLines` | `scripts/mso-agent-composer-ui.mjs:27-113` | yes, pure; the only surviving part of the composer |
| `streamTurn(..., output)` injectable sink | `scripts/mso-agent-runtime.mjs:73-80,150,165` | yes, the single most valuable seam: streamed text can be redirected into a view with no API change |
| `print` / `printErr` injection | `scripts/mso-agent-edit-diff.mjs:116`, `scripts/mso-agent-todos.mjs:179`, `scripts/mso-agent-diff.mjs:107-108`, `scripts/mso-agent-files.mjs:127-128` | yes, these already accept a sink |
| `AgentActivity` live row | `scripts/mso-agent-activity.mjs:66-219` | no: inseparable from `\r` + `\x1b[2K` and a single row (`:164,196`). Its formatters (`:34-52`) survive |
| `AgentComposer` write loop | `scripts/mso-agent-composer.mjs:39-62` | no: cursor-relative writes and `reserveComposerRows` are replaced by a frame writer |
| `activity.clear()` before a block print | `scripts/mso-agent-edit-diff.mjs:119-124`, `scripts/mso-agent-todos.mjs:182-187` | no: in a frame model, blocks append to a buffer instead of being logged after clearing a row |
| banner | `scripts/mso-agent-ui.mjs:139-193` | pinned by `scripts/mso-agent-contract.test.ts:8-30`, which asserts the exact art, the six RGB triples, and identifiers such as `AgentComposer`, `composerPrompt`, `sectionDivider`, `Agent work`, `Local agent` |

## 5. The precedent already in the repo

`scripts/integrations-tui/` is a dependency-free retained renderer that already
ships:

- a pure frame function `buildFrame(config, {cols, rows})` returning an array of
  styled lines (`scripts/integrations-tui/renderer.mjs:5`), including a 3-column
  pane grid with borders (`:6`), an inspector pane (`:8`), section tabs (`:3`), and
  height-dependent inspector rows (`:9`);
- a painter `paint(output, lines)` that homes, clears, hides the cursor, and writes
  each line at an absolute row (`renderer.mjs:14`);
- cell-accurate layout including CJK and emoji widths (`layout.mjs:6-33`);
- an alternate-screen wrapper with `trap ... EXIT INT TERM`
  (`scripts/mso-cli-integrations-tui.sh:12-13,39,50`);
- a real PTY test across 6 terminal sizes (`scripts/mso-integrations-finder-pty.test.ts:48`).

What it is not, and what the agent needs: `paint` repaints the whole screen every
frame (`renderer.mjs:14`, `\x1b[H\x1b[2J` then every line), it never restores
content on exit, it hides the cursor without a matching show, and it has no dirty
region, no mouse, no scrollbar and no in-flight async work (the wrapper re-runs node
per keystroke, `mso-cli-integrations-tui.sh:42`). The agent has a 120 ms spinner
(`scripts/mso-agent-activity.mjs:16`) and a token stream
(`scripts/mso-agent-runtime.mjs:150`), so a full clear per frame is not acceptable.

This precedent is the strongest argument for Option A: the primitives, the PTY test
pattern and the alt-screen teardown pattern already exist and are already green.

## 6. Three options

### Option A: alternate screen plus a custom retained renderer inside the repo

What it changes:

- new modules under `scripts/tui/` (or `scripts/mso-agent-view-*.mjs`), each at or
  under 220 physical lines: cell/width math promoted from
  `scripts/integrations-tui/layout.mjs`, a line-diff frame writer (CUP plus
  erase-to-end-of-line per changed row), a transcript view that owns a buffer of
  styled lines, a chrome view (tab row, footer), and an input map;
- `AgentComposer` keeps `inputLayout`/`inputViewport`/`verticalCursor`/`menuLines`
  (`scripts/mso-agent-composer-ui.mjs:27-113`) and loses its write loop
  (`scripts/mso-agent-composer.mjs:39-62`);
- `streamTurn`'s injectable sink (`scripts/mso-agent-runtime.mjs:73-80`) is pointed
  at the transcript view instead of stdout;
- `lazyAssistantOutput` (`scripts/mso-agent-turn.mjs:20-33`) becomes a buffer append;
- `AgentActivity` becomes one row of the frame, and its formatters
  (`scripts/mso-agent-activity.mjs:34-52`) move to a new module so the 220-line file
  can shrink;
- alt screen entered and left inside node, with `process.on("exit")`, SIGINT, SIGTERM
  and SIGHUP teardown.

Why a dirty-region writer and not a cell grid: every rendered row is already a fully
styled string (`scripts/mso-agent-composer-ui.mjs:90-113`,
`scripts/integrations-tui/layout.mjs:47-51`). A row-level diff (`CUP` plus `\x1b[2K`
plus text, only for rows that changed) is enough to stop flicker, and it avoids
per-cell state on top of the existing wide-char handling (`layout.mjs:6-33`).

Cost: six to eight new modules, roughly 900 to 1200 new lines by the repository's own
ruler, plus PTY tests for resize, alt-screen teardown, and streaming under load.
No install, audit or supply-chain cost.

What it breaks:

- scrollback, the moment the alt screen is entered (section 1.5). Mitigation: ship
  inline mode first (M2 to M4), keep the alt screen behind a flag (M5), and add a
  transcript view before the flag defaults on;
- the composer unit tests that assert "no `\n`" if the writer ever emits line feeds
  (`scripts/mso-agent-composer.test.ts:54,60`,
  `scripts/mso-agent-composer-session.test.ts:76`,
  `scripts/mso-agent-activity.test.ts:48`);
- `scripts/mso-agent-contract.test.ts:8-30` if the banner, the section labels or the
  module identifiers change;
- `scripts/capture-cli.mjs:91-99`, which drives the real TUI in a PTY, waits for
  `Welcome to MSO Agent!` and asserts `Available Tools`, then writes
  `docs/media/mso-cli.webp`; the capture must be re-run and reviewed;
- [WORKSPACE-GUIDE.md](./reference/WORKSPACE-GUIDE.md):229-248 (documented key map)
  and the parity status rows in [TUI-PARITY-PLAN.md](./TUI-PARITY-PLAN.md):56-62.

Gates touched: `architecture` (every new file at or under 220 physical lines, and
`activity` must shrink before it grows), `lint` (code-line ceiling, note the one line
left in the composer), `docs` (this file's classification plus the key-map update),
`changelog`, `tests` / `tests + coverage`.

### Option B: adopt one TUI library

Named candidate that could actually install here: `ink` 8.0.0 (MIT, node >= 22,
619,872 B unpacked, 23 runtime deps including WASM `yoga-layout ~3.2.1` and
`patch-console`, peer React >= 19.3.0). `@opentui/core` 0.8.0 is excluded by its own
engine range (node >= 26.4.0) against `package.json:6-9`. `blessed` 0.1.81 is
unmaintained.

What it changes: the CLI becomes a React renderer. Every one of the 115 direct write
sites must be routed: either converted to elements or pushed through ink's static
output. `AgentComposer`'s key loop is replaced by the library's input hook. The
120 ms spinner (`scripts/mso-agent-activity.mjs:16`) and the token stream
(`scripts/mso-agent-runtime.mjs:150`) must be throttled into frames. `spawnSync` with
`stdio: "inherit"` (`scripts/mso-agent-commands.mjs:23-24`) must release the
terminal, and `/restart`'s `execve` (`scripts/mso-agent-lifecycle.mjs:36`) must tear
the renderer down first.

Cost: one runtime dependency, 23 transitive packages, a React reconciler in the CLI
path, and an adapter layer that is itself subject to the 220-line rule. Panels and
list scrolling exist in the library; session tabs, a scrollbar styled like the rest
of MSO, and split panes are still application code.

What it breaks: the global `console` contract (ink depends on `patch-console`; the
exact interaction with 100 existing `console.log` sites is unverified), the formatter
tests, and any expectation that `mso agent` runs on a host where only `bun install`
has happened, because the install now pulls a reconciler and WASM layout engine.

Gates touched: `bundle budget` does **not** apply (`scripts/lib/bundle-report.mjs:17-24`
measures `.next` only). Applicable: frozen lockfile install (`ci.yml:38`), `audit strict`
(`gates-12.sh:44`), dependency review on high severity, `lint`, `architecture`, `docs`,
`changelog`, `tests`. The `native dependency` gate would not validate this dependency
either way, because it is hardcoded to node-pty (`gates-12.sh:36`).

Verdict: permitted by policy, and still the wrong first move. It replaces a rendering
problem with a dependency, a reconciler and an unverified console interaction, and it
does not deliver tabs, scrollbar or splits by itself.

### Option C: keep the renderer, add only cheap wins

What it changes:

- a fixed bottom chrome block of two or three rows (session tab row, then the
  existing `Input` divider and footer), painted through the row-reservation
  machinery that already exists (`scripts/mso-agent-composer-ui.mjs:13-25`), so the
  chrome is repainted in place and adds no scrollback;
- a static panel layout: transcript stays append-only, the bottom block is the only
  retained region;
- mouse-free navigation: new keybindings only, no new input decoder.

Cost: one new module of about 80 to 140 lines, one or two lines of change in the
composer render, one new test. No dependency, no alt screen, scrollback intact.

What it breaks: nothing structural. Gains are bounded: tabs are a labelled row, not
switchable views with independent state; there is no scrollbar because there is no
transcript viewport; there are no split panes.

The obvious variant, a header pinned at the top of the screen, needs a DECSTBM scroll
region (`\x1b[1;Nr`) because the transcript is still an append-only stream. On
xterm-compatible terminals lines that scroll out of the top of a region whose first
row is not row 1 are discarded rather than pushed to scrollback, so a pinned top
header trades away scrollback without an alternate screen. That behaviour is
unverified on Termux, Windows Terminal and macOS Terminal (section 11), which is why
the recommendation puts the chrome at the bottom, where the existing reserved-row
machinery already repaints in place.

Gates touched: `architecture` (new module under 220), `lint`, `tests`, `docs` if the
key map changes, `changelog`.

## 7. Recommendation

Take Option A, sequenced so that the risky half is last: adopt the retained frame
model first in inline mode (scrollback preserved, no alt screen, no flag), then put
the alternate screen, tabs, scrollbar and mouse behind an explicit opt-in once a
transcript view exists. Do not take Option B now. Keep Option C as the fallback if
the owner rejects scrollback loss entirely, because C is a strict subset of A's first
three milestones.

Reasons, in order of weight:

1. Option A needs no dependency, so it cannot fail `audit strict`, dependency review,
   `bun install --frozen-lockfile`, or the install matrix on Termux/PRoot
   (`docs/PLATFORMS.md:12-14,79-85`). Option B's only viable candidate adds 23
   packages and a reconciler to a CLI that currently runs on `node` plus the repo.
2. The primitives already exist and are already tested: cell widths and panes
   (`scripts/integrations-tui/layout.mjs:1-66`), a pure frame builder and painter
   (`scripts/integrations-tui/renderer.mjs:5,14`), an alt-screen wrapper with a trap
   (`scripts/mso-cli-integrations-tui.sh:12-13,39,50`), and a PTY test across six
   terminal sizes (`scripts/mso-integrations-finder-pty.test.ts:48`).
3. The agent already has the two hardest seams a rewrite normally lacks: an
   injectable stream sink (`scripts/mso-agent-runtime.mjs:73-80`) and a set of pure
   block formatters (`scripts/mso-agent-diff.mjs:84-100`,
   `scripts/mso-agent-edit-diff.mjs:61-99`, `scripts/mso-agent-todos.mjs:101-149`).
   The work is layout and state, not protocol.
4. The ratchet forces the right shape anyway: 43/43 files over 220 physical lines
   (`scripts/check-architecture.mjs:21`) means the renderer must be split into small
   pure modules, which is exactly what makes it testable without a PTY.

Cost in milestones (file level, not a time estimate): see section 8. The critical
path is M2 (transcript model) then M3 (frame writer); everything visual depends on
those two, and mouse/scrollbar/splits are additive after M5.

## 8. Migration order, gates green after every step

### Status, updated as milestones land

| Milestone | Work | State | Evidence |
|---|---|---|---|
| M0 | This plan, classified in docs/README.md | DONE | PR #185, `2dfcda8` |
| M1 | Shared cell primitives, `scripts/tui/cells.mjs` | DONE | PR #186, `5b45314`; layout.mjs 67 to 20 lines |
| M2 | Transcript model, `scripts/mso-agent-transcript.mjs` | DONE | PR #187; reuses formatEditDiff, formatTodoBlock, formatDiffBody |
| M3 | Frame writer, `scripts/mso-agent-screen.mjs`, inline mode | DONE | PR #189; composer 221 to 217 lines, ratchet 43 to 42 |
| M4 | Chrome and tabs as a bottom block | DONE | PR #191; chromeLines and tabs switch; composer 216 lines |
| M5 | Alternate screen behind a flag, with teardown | DONE | PR #192; default off; teardown on exit, signals, execve, spawnSync |
| M6 | Transcript viewport and scrollbar | DONE | PR #193; 2000-line cap, follow mode, PgUp/PgDn/Ctrl+G/End, entrypoint 218 to 196 lines |
| M7 | Mouse | DONE | SGR 1000/1006 extended mode, wheel scrolls viewport, tab clicks switch session |
| M8 | Split panes, then flip the alt screen default | NOT STARTED | needs M6 and M7 |

Adjacent work that landed while this plan was being executed, and belongs to the same goal:
`feat/agent-jobs-view` (#183, `/jobs` for background subagents) and `feat/tui-keybinds` (#182,
`~/.mso/keybinds.json`), which closed P2-3.

M0. Documentation. This file, one classification row in `docs/README.md` (required by
`scripts/check-docs.mjs:56-63`), a pointer from
[TUI-PARITY-PLAN.md](./TUI-PARITY-PLAN.md):56-62, and
`node scripts/gen-changelog.mjs`. Gates: `docs`, `changelog`, `architecture` (no code
change), `lint`, `typecheck`.

M1. Extract shared cell primitives. New `scripts/tui/cells.mjs` (about 90 lines:
`stripAnsi`, `clean`, `cellWidth`, `fitCells`, `compose`, `windowFor`, `paneWidths`,
`border`, `paneRow`), moved out of `scripts/integrations-tui/layout.mjs:1-66`;
`layout.mjs` re-exports them so `scripts/mso-integrations-finder-pty.test.ts` and
`scripts/mso-integrations-finder.test.ts` stay untouched. New
`scripts/tui/cells.test.ts`. Gates: `architecture` (two files, both under 220),
`lint`, `tests`, `changelog`.

M2. Transcript model. New `scripts/mso-agent-transcript.mjs` (about 180 lines) that
turns history rows and live blocks into an array of styled lines, reusing
`formatEditDiff`, `formatTodoBlock`, `formatDiffBody`, `sectionDivider`. It must
handle the row shapes actually persisted: assistant rows with `toolUses`, `tool` rows
with compacted results (`scripts/mso-agent-context.mjs:100,148`), and `agent` rows
(`scripts/mso-agent-local.mjs:67-82`). No rendering change yet: add `/transcript`
style output first, or a single `renderTranscript(history)` used by `/export`
parity. Gates: `architecture`, `lint`, `tests`, `docs` if a command is added
(`docs/CLI.md` is generated and checked by `scripts/check-docs.mjs:100-102`).

M3. Frame writer, inline mode. New `scripts/mso-agent-screen.mjs` (about 180 lines):
`writeFrame(output, previousLines, nextLines)` diffing row by row with `CUP` plus
`\x1b[2K`, a resize subscription that reuses `output.on("resize")`
(`scripts/mso-agent-composer.mjs:204`), and cursor hide/show paired. Move the
composer write loop (`scripts/mso-agent-composer.mjs:39-62`) into it. Constraint:
`composer.mjs` has one code line of lint headroom, so the moved code must leave more
lines behind than it adds, or move `reserveComposerRows`/`eraseComposerRows`
(`scripts/mso-agent-composer-ui.mjs:13-25`) wholesale. The existing composer tests must
pass unchanged, including the no-`\n` assertions.

M4. Chrome and tabs as a bottom block. New `scripts/mso-agent-chrome.mjs` (about 130
lines) rendering a tab row (`@name` per session) and the footer from `statusParts`
(`scripts/mso-agent-status.mjs:62-88`) and `composerFooter`
(`scripts/mso-agent-layout.mjs:49-60`), painted by M3 above the composer. Tabs switch
by reusing the existing session switch path (`scripts/mso-agent-session-ui.mjs:65-82`)
rather than by introducing parallel session objects. No alt screen yet, so scrollback
survives.

M5. Alternate screen behind a flag. Add `enterScreen`/`leaveScreen` with teardown on
`exit`, SIGINT, SIGTERM, SIGHUP, and explicit release before `spawnSync(... stdio:
"inherit")` (`scripts/mso-agent-commands.mjs:23-24`) and before `execve`
(`scripts/mso-agent-lifecycle.mjs:36`). Shrink `scripts/mso-agent-activity.mjs` below
220 physical lines first (move the frame table and formatters to
`scripts/mso-agent-activity-format.mjs`) or the gate fails on the first added line.

M6. Transcript viewport and scrollbar. Keys PgUp/PgDn, Ctrl+G and Ctrl+Shift+G where the terminal reports it, plus a
scrollbar column rendered from `windowFor` (`scripts/integrations-tui/layout.mjs:60-66`).
Wire `streamTurn`'s sink (`scripts/mso-agent-runtime.mjs:73-80`) and
`lazyAssistantOutput` (`scripts/mso-agent-turn.mjs:20-33`) to append to the buffer
instead of stdout.

M7. Mouse. SGR reporting (`\x1b[?1002h` / `\x1b[?1006h`) plus decoding, wheel to
scroll, click to focus a pane. Only after the owner decides the selection policy
(open question 6).

M8. Split panes. Reuse `paneWidths`, `border`, `paneRow`
(`scripts/integrations-tui/layout.mjs:35-51`) for a right-hand panel (todos, diff,
files). Then flip the alt screen default on, and keep inline mode for `--oneshot`
(`scripts/mso-agent-oneshot.mjs`) and non-TTY callers.

First three commits, concretely:

1. `docs(tui): add retained renderer plan and classify it`
   files: `docs/TUI-RENDERER-PLAN.md` (new), `docs/README.md` (one row next to
   `TUI-PARITY-PLAN.md` at `:64`), `docs/TUI-PARITY-PLAN.md` (Phase 2 pointer),
   `docs/CHANGELOG.md` (regenerated). Run `node scripts/check-docs.mjs`,
   `node scripts/check-architecture.mjs`, `node scripts/gen-changelog.mjs --check`.
2. `refactor(tui): share cell-width and pane primitives`
   files: `scripts/tui/cells.mjs` (new), `scripts/tui/cells.test.ts` (new),
   `scripts/integrations-tui/layout.mjs` (re-export only, smaller than today's 67 lines),
   `docs/CHANGELOG.md`. Run `architecture`, `lint`, `vitest run
   scripts/tui/cells.test.ts scripts/mso-integrations-finder.test.ts
   scripts/mso-agent-layout.test.ts`.
3. `refactor(agent): paint the composer through a frame writer`
   files: `scripts/mso-agent-screen.mjs` (new), `scripts/mso-agent-composer.mjs`
   (replace the write loop; the file is at 219 of the 220 lint code lines, so the move
   must not add code lines to it),
   `scripts/mso-agent-composer-ui.mjs` (receive `reserveComposerRows` and
   `eraseComposerRows`, 105 code lines now, headroom 115),
   `scripts/mso-agent-screen.test.ts` (new). Run `architecture`, `lint`,
   `vitest run scripts/mso-agent-composer.test.ts
   scripts/mso-agent-composer-wrap.test.ts scripts/mso-agent-composer-session.test.ts
   scripts/mso-agent-activity.test.ts`.

## 9. What must not be attempted

1. **A renderer file larger than 220 physical lines.** `filesOver220` is exactly at
   its ceiling (43/43, `node scripts/check-architecture.mjs`), and
   `architecture.boundaries.json:20` forbids raising a ratchet without an explicit
   architecture decision. The gate fails on the first such file.
2. **Adding any line to `scripts/mso-agent-activity.mjs` before removing one.** It is
   exactly 220 physical lines; one more line makes the count 44. Its lint headroom is
   irrelevant because `architecture` fails first.
3. **Growing `scripts/mso-agent-local.mjs` or `scripts/mso-agent-composer.mjs` in
   code lines.** Local is at 220 of 220 code lines; the composer at 219 of 220. With
   `--max-warnings=0` (`scripts/gates-12.sh:34`) a single warning fails `lint`.
4. **Entering the alternate screen before a transcript view exists.** Nothing replays
   history (section 1.5), so `/resume` would render an empty screen and quitting would
   destroy the only record of the conversation. `/export`
   (`scripts/mso-agent-cmd-parity.mjs:45`) is the only current recovery path.
5. **Relying on a bash trap in the launcher to restore the screen.** The launcher
   `exec`s node (`scripts/mso-cli-agent.sh:397-399`), so no shell code survives to run
   a trap. Teardown must be in-process, or the `exec` must be removed and the installer
   and CLI contract re-verified.
6. **Shipping `@opentui/core` as a drop-in.** Registry metadata for 0.8.0 declares
   `node >= 26.4.0` against `package.json:6-9` (`^22.12.0 || ^24.0.0 || >=26.0.0`),
   ships an 18 MB package plus 8 platform-native packages, and no gate would catch the
   mismatch: `native dependency` only checks node-pty (`scripts/gates-12.sh:36`).
7. **A full-screen clear per frame** (the Integrations approach,
   `scripts/integrations-tui/renderer.mjs:14`). With a 120 ms spinner
   (`scripts/mso-agent-activity.mjs:16`) and SSE deltas
   (`scripts/mso-agent-runtime.mjs:150`) this flickers and loses the cursor position
   that the composer currently guarantees (`scripts/mso-agent-composer.mjs:55-61`).
8. **Renaming or deleting the contract strings.** `scripts/mso-agent-contract.test.ts:8-30`
   asserts the exact banner art, six RGB triples, and identifiers including
   `AgentComposer`, `composerPrompt`, `composerFooter`, `composerSeparator`,
   `sectionDivider`, `Agent work`, `Local agent`. Change them only together with that
   test.
9. **Editing `bin/mso` or `scripts/install-core.sh` for this feature.** They sit at
   212 of 220 and 450 of 450 respectively (`scripts/check-architecture.mjs:47-48`).
10. **Turning on mouse tracking before deciding selection policy.** SGR mouse
    reporting disables native text selection; the TUI's exported transcript is the
    replacement, and `/export` is a round trip.

## 10. Open questions for the owner, ranked

1. **Is losing terminal scrollback acceptable?** If no, the alternate screen is off
   the table forever and the plan collapses to Option C plus A's inline milestones
   (M0 to M4). This single answer changes more than any other.
2. **Is a new runtime dependency acceptable at all, and if OpenTUI is the target is
   the Node floor movable to 26.4?** The first half decides ink, the second decides
   `@opentui/core`; today `package.json:6-9` excludes the latter.
3. **Must the TUI keep working on Node 22 and 24 hosts?** This alone decides whether
   OpenTUI can ever be considered; it also decides whether WASM dependencies are
   acceptable on Termux/PRoot (`docs/PLATFORMS.md:12-14`).
4. **Is a reconstructed transcript allowed to show compacted tool results?** The
   runtime deliberately replaces read-tool payloads with bounded envelopes
   (`scripts/mso-agent-turn.mjs:140-143`, `scripts/mso-agent-context.mjs:100`), so a
   replay view will not match what scrolled by live. Accepting that difference is a
   product decision.
5. **Do tabs mean multiple live sessions or one session with a switcher?** Multiple
   live sessions need one `LocalAgentBridge` per session
   (`scripts/mso-agent-local.mjs:84-97,105-124,158-201`), each with its own feed and
   heartbeat. A switcher reuses `scripts/mso-agent-session-ui.mjs:65-82` and costs
   almost nothing.
6. **Is losing native text selection for click and wheel acceptable?** If not, mouse
   is wheel-only at reduced value, or skipped.
7. **Is the scrollbar required for the first ship?** It is pure cost until the
   transcript viewport (M6) exists.
8. **Should `/restart` preserve screen state?** It currently `execve`s a new process
   (`scripts/mso-agent-lifecycle.mjs:36`); an alt screen must be left before that, and
   re-entered after, or the new process inherits the old screen.

## 11. Explicitly unverified

- Runtime behaviour of `ink` 8.0.0 and `@opentui/core` 0.8.0 inside this repository.
  Only registry metadata was read; neither was installed.
- Whether `ink`'s `patch-console` dependency interferes with the 100 existing
  `console.log` call sites. The dependency is listed in registry metadata; the
  interaction was not tested.
- The "live PTY regression" for zero-scrollback Tab cycling claimed in
  `docs/PROGRESS.md:2649`. No such test exists in the current tree; only
  `scripts/mso-integrations-finder-pty.test.ts` uses a real PTY.
- Terminal-specific behaviour of a pinned header via a DECSTBM scroll region on
  Termux, Windows Terminal and macOS Terminal. Not tested here, and it is why the
  recommendation keeps chrome at the bottom of the screen.
- Exact coverage impact of replacing the composer write loop. Coverage thresholds
  (statements 42 / branches 40 / functions 32 / lines 43.5, `scripts/gates-12.sh:47-49`)
  were not measured for a candidate change.

## 12. One-line summary

The agent TUI is 15 modules and 115 direct write sites of append-only output with no
frame, no alt screen, no mouse and no transcript buffer; the repository already owns
a dependency-free frame renderer for Integrations and a hard 43/43 line ratchet, so
the correct path is a split, dependency-free frame writer in inline mode first, with
session tabs and a bottom chrome as the cheapest visible change and the alternate
screen, scrollbar, mouse and splits deferred behind a flag until a transcript view
exists.
