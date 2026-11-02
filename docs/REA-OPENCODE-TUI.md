# REA: opencode TUI, what it is and what to learn from it

Reverse-engineered from the installed binary, not from screenshots. Every claim below has the probe
that produced it, because the point of this document is that the next person does not have to repeat
the extraction.

opencode is open source. Everything here is published, readable and freely usable, so this is a study
of a peer implementation rather than a reconstruction of something hidden. The sections that say do
not copy are about *fit*, not permission: a design that works in a native scene-graph renderer does
not automatically work in MSO's line painter, and shipping it anyway would cost capability for looks.


## 0. Method, and what failed first

The `REA` skill is **not installed** on this machine. Checked: `~/.config/opencode/skills/`,
`~/.agents/skills/`, `~/.claude/skills/`, `~/.codex/`, and the recovery archive index. No skill by that
name exists. So this is the method applied directly rather than a skill invocation.

What the target actually is, established before reading anything into it:

```
$ ls -la ~/.local/bin/opencode
... -> ~/.opencode/bin/opencode

$ file ~/.opencode/bin/opencode
ELF 64-bit LSB executable          # NOT a JS script with a shebang
$ du -h                      241M
$ strings | grep -oE "Bun v[0-9.]+"
Bun v1.4.4                          # Bun standalone executable
$ strings | grep -c bubbletea
0                                   # NOT Go/charmbracelet
```

**The TUI is OpenTUI, not bubbletea.** That single fact changes what is worth copying: OpenTUI is a
native FFI scene-graph renderer (Yoga layout, WebGPU-ish paint hooks, its own frame scheduler), which
is why opencode's transitions and mouse handling look the way they do. MSO's renderer is a
hand-written retained line painter, so the *architecture* is not portable; the *layout decisions* are.

Extraction: `strings -n 6` over the 241 MB ELF gives ~525k lines. Grep by feature name, never read
whole regions. The bundled JS appears as one enormous line per module, so `grep -o` with a bounded
context is the only usable probe.

## 1. The TUI library

```
$ strings | grep -oE "charmbracelet/[a-z]+" | sort -u     -> (nothing)
$ strings | grep -iE "opentui"                            -> many hits
```

Evidence of the actual engine, quoted from the bundle:

- `yogaConfigCreateChecked`, `yogaNodeCalculateLayoutChecked`, `yogaNodeStyleSetEnumChecked`: Yoga
  flexbox for layout, the same engine React Native uses.
- `ot_scene_record_draw`, `ot_buffer_draw_box`, `ot_buffer_draw_text`: a retained **scene graph**, not
  a string builder. Rects are records in a buffer, painted natively.
- `"OpenTUI is not supported on the current platform: linux-x64"`: explicit platform gate.
- `OTUI_DEBUG_FFI`, `OTUI_TRACE_FFI` env vars: FFI call tracing, useful if we ever need to debug it.
- Renderer modes: `alternate-screen`, `split-footer`, with `capture-stdout` external output mode.
  `split-footer` is how opencode keeps its own bottom bar while external processes print above it.

**Consequence for MSO:** porting the engine is not the lesson; the engine is a different trade. What
transfers is that opencode treats the terminal as a paint surface with a reserved footer, and keeps
external process output (`split-footer` + `capture-stdout`) from corrupting it. MSO already does the
second half with `PROMPT_ROWS` and the suspended-panel path, so this confirms the existing direction
rather than proposing a rewrite.

## 2. The settings registry, which is the real design document

The single most useful find: opencode declares its entire TUI surface as a data table, and the UI is
generated from it. Quoted structure (`title`, `category`, `path`, `default`, `values`):

| Category | Setting | Path | Default |
|---|---|---|---|
| Appearance | Theme / Color mode / Animations | `theme.name`, `theme.mode`, `animations` | `opencode`, `system`, off |
| **Session** | **Sidebar** | `session.sidebar` | **`auto`** (hide \| auto, "shows when there is room") |
| Session | Scrollbar / Thinking / Markdown | `session.scrollbar`, `.thinking`, `.markdown` | off, hide, rendered |
| Session | Tool grouping / **Verbosity** | `session.grouping`, `session.verbosity` | `auto`, **`medium`** (low/medium/high) |
| Session | Transcript images / TPS | `session.image_preview`, `session.tps` | off, on |
| **Tabs** | **Mode / Scope / Layout / Indicators** | `tabs.mode`, `tabs.scope`, `tabs.layout`, `tabs.indicators` | `auto`, `cwd`, **`horizontal`**, **`status`** |
| Diffs | View / Wrapping / File tree / Single patch | `diffs.view`, `.wrap`, `.tree`, `.single` | auto, word, on, off |
| Input | Scroll speed / Acceleration / Mouse | `scroll.speed`, `.acceleration`, `mouse` | 3, off, **on** |
| Input | Editor context / Large pastes | `prompt.editor`, `prompt.paste` | on, compact |
| Alerts | Notifications / Sounds / Volume | `attention.notifications`, `.sound`, `.volume` | off, off, 0.4 |
| Terminal | Window title / Copy behavior | `terminal.title`, `terminal.copy` | on, select |
| Debug | Developer tools | `debug.devtools` | off |

Two entries answer questions the user asked directly:

- `tabs.layout` has values **`horizontal` | `vertical`**, and the description for `vertical` is
  literally *"tabs run along the top or down the side"* with keywords `sidebar`, `orientation`, `left`.
  So the vertical session rail in the screenshot is **the same tab list, moved to the left edge**, not
  a second component.
- `session.sidebar` is `auto` with *"shows when there is room"*. Same rule MSO's pane already uses
  (`paneWidth` returns 0 below 100 columns).

## 3. Sidebar slots

```
$ strings | grep -oE "opencode\.sidebar\.[a-z_]+" | sort -u
opencode.sidebar.context
opencode.sidebar.footer
opencode.sidebar.limit
opencode.sidebar.mcp
opencode.sidebar.todo
```

Five fixed slots, not one free-form panel: **context, mcp, todo, limit, footer**. That is a better
shape than MSO's current `paneKind` enum because each slot has one job and can be rendered
independently.

Note the split: `sidebar.context` is context usage, `sidebar.limit` is quota/rate limit, and
`sidebar.mcp` is MCP server state. MSO's `context` pane currently merges context usage and provider
identity, and has no quota concept.

## 4. Session status, and how tabs indicate it

`tabs.indicators` = `status` (default) | `numbers`. The description: *"whether tabs show status icons or
always numbers"*, keywords `tab numbers`, `number mode`, `status icons`.

Status vocabulary found in the bundle (bounded to the state field): `idle`, `busy`, `working`,
`waiting`, `streaming`, `thinking`. So opencode **does** carry a live per-session activity signal, which
is exactly what the MSO `/tabs` work had to work around: MSO's server exposes only `updatedAt`, so
`sessionTable` had to derive state from a 60-second threshold and print `no activity data` when it
could not tell.

That is the honest gap, and it is a **server-side** gap, not a UI one. Copying the icons without the
signal would produce a tab row that lies.

## 5. Command registry

Named commands, which is the shape a keybind file should mirror:

```
session.sidebar.toggle      session.tab.next / .previous / .next_unread / .previous_unread
session.tab.close / .reopen  session.timeline        session.rename / .delete / .share / .unshare
session.copy / .move / .fork session.queued_prompts  session.child.first  session.parent
session.pin.toggle           session.quick_switch.1  …
diff.toggle / .expand / .expand_all / .collapse / .switch_focus
diff.next_hunk / .previous_hunk / .next_file / .previous_file
diff.toggle_file_tree / .single_patch / .switch_source / .toggle_view
theme.switch / .switch_mode  theme.mode.lock         prompt.editor      open.menu
```

Two worth stealing outright: **`session.tab.next_unread`** (jump to the next session that needs
attention, rather than cycling through idle ones) and **`session.queued_prompts`** (a visible queue,
which MSO already has in memory as `session.queue` but does not surface).

## 6. Terminal access, the surprising answer

`/terminal` as an opencode slash command **does not appear in the string table**. What does appear is:

- An experiment, `client-mcp`, described as *"Let the agent open terminals in this TUI (requires server
  support)"*, stored under `experimental["client-mcp"]`.
- `terminalSuspend`: a renderer control, i.e. the TUI suspends itself to hand the terminal away.
- One command id, `terminal.close`.

So opencode's model is **the agent opens a terminal as a tool**, rendered inside the TUI, rather than
the user typing `/terminal` to borrow the shell. MSO's `/terminal` (PR #224) does the suspend-and-hand-
over the other way round. Both are legitimate; they answer different needs:

| | opencode (`client-mcp`) | MSO `/terminal` |
|---|---|---|
| who drives | the agent, as a tool | the user, as a command |
| where output goes | into the TUI panel | to the real terminal |
| state after | panel keeps its layout | panel re-enters and repaints |

## 7. What to learn, ranked by value per line, and what MSO must not give up

Adopting each idea below is only worth it if the capability MSO already has survives. The third column
is the constraint that decides whether we may take it at all.

| # | Idea from opencode | MSO capability that must not regress |
|---|---|---|
| 1 | **Settings as one data table** (title, category, path, default, values) driving both the settings UI and the keybind hints | `/keybind` already writes `~/.mso/keybinds.json` and validates conflicts. A registry must wrap that file, not replace it: a user's existing keymap has to keep working byte for byte |
| 2 | **`tabs.layout: horizontal \| vertical`**, the vertical rail being the same tab list moved to the left edge | `tabLayout` is the single source of truth for both `tabRow` and `tabAtPoint`. A vertical variant must reuse it, or the click targets will drift from the painted row, which is the bug M4 already fixed once |
| 3 | **Sidebar slots as fixed roles** (context, mcp, todo, limit, footer) instead of a cycling kind | `/pane off` must stay one keystroke. Cycling is fast when you do not know what you want; slots are better once you do. Keep cycle, add pinning |
| 4 | **`session.tab.next_unread`** | The tab click and `/tabs <n>` switch paths must stay one function (`switchToSession`), including the todo-cache clear |
| 5 | **Surface the queued prompts** | `session.queue` already exists in memory and is drained per turn. Showing it must not change drain order or let a queued prompt jump the approval gate |

Three specific refusals, each because taking it would cost capability:

- **The OpenTUI engine.** MSO's renderer is line-based and dependency-free; the whole reason it exists is
  that `ink` drags 23 packages and `@opentui/core` needs Node 26.4 while the repo supports 22.12+. Layout
  ideas transfer, the runtime does not.
- **Status icons on tabs before the server has a signal.** opencode carries `idle`/`busy`/`working`/
  `waiting`/`streaming`/`thinking`. MSO's session API exposes only `updatedAt`, which is why `sessionTable`
  derives a 60 second threshold and prints `no activity data`. Drawing an icon from a timestamp would make
  the tab row assert something it cannot know. The fix is server side; until then the honest text stays.
- **`/terminal` as agent-owned panels.** opencode's `client-mcp` experiment lets the *agent* open terminals
  inside the TUI. MSO's `/terminal` (PR #224) hands the *user* the real terminal via the suspend path. They
  solve different problems, and replacing ours with theirs would remove the ability to drop into a real
  shell mid-session, including for things the agent should not mediate.

## 8. Reproducing this

```bash
strings -n 6 ~/.opencode/bin/opencode > /tmp/oc-strings.txt     # 525k lines, ~1 min
grep -oE "opencode\.sidebar\.[a-z_]+" /tmp/oc-strings.txt | sort -u
grep -oE "\"tabs\"[^}]{0,120}" /tmp/oc-strings.txt
grep -iE "opentui|yoga" /tmp/oc-strings.txt | head
```

Do not `grep` without `-o` and a bounded context: individual module lines are megabytes long and will
flood the terminal. This happened twice while writing this document.
