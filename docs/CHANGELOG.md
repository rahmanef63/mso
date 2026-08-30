# Changelog

**Generated — do not edit.** `node scripts/gen-changelog.mjs`, run by `bun run ship`.
Newest first. `docs/PROGRESS.md` is the source of truth for *why* a change was made;
this is the *what*, and it is what Settings → About shows as “What's new”.

## 2026-08-30

**Added**

- `gateway` secure laptop public access lifecycle
- `gateway` add loopback-only public web gateway

**Fixed**

- `gateway` close tunnel fork signal race
- `gateway` serialize offline recovery state
- `gateway` harden update and proxy edges
- `gateway` close lifecycle review gaps
- `security` harden gateway scanner fixtures
- `install` survive Bun bin metadata corruption
- `install` keep bootstrap guard shellcheck-clean
- `install` guard earliest bootstrap prefix
- `install` make bootstrap handoff truncation-safe
- `install` make one-line bootstrap atomic
- `install` bind readiness to runtime instance
- `install` preserve caller path semantics
- `install` prove stable-id service takeover
- `install` keep security hint literal
- `install` make WSL CLI setup reliable
- `security` harden GitHub quality controls
- `security` canonicalize writable path containment

**Tests**

- `gateway` harden hosted security fixtures

**Docs**

- `security` disclose scorecard posture gaps

## 2026-08-29

**Fixed**

- `security` keep path sinks in validated branches
- `security` make root containment explicit
- `security` close follow-up CodeQL flows

**Docs**

- `comparison` use explicit SEO-friendly ratings

**Chores**

- `deps` hold incompatible toolchain majors
- `deps` migrate to lucide-react 1.33.0

## 2026-08-28

**Added**

- `operations` add evidence-backed comparison and delegated control
- `mcp` add bounded async exec jobs

**Fixed**

- `security` remediate hosted CodeQL findings
- `security` remediate ultimate assurance findings
- `security` resolve full assurance findings
- `security` raise complete component scan budget
- `security` keep Codex scan state private
- `security` block recursive credential relocation

**Chores**

- `deps` bump actions/setup-python from 6.3.0 to 7.0.0
- `deps` bump zaproxy/action-baseline
- `deps` bump actions/setup-node from 6.5.0 to 7.0.0
- `deps` bump actions/upload-artifact from 4.6.2 to 7.0.1
- `deps` bump ossf/scorecard-action in the actions-minor-patch group
- `deps-dev` bump the development-minor-patch group with 4 updates
- `deps` bump the production-minor-patch group with 4 updates
- `security` update Codex Security to 0.1.21

## 2026-08-26

**Added**

- `mcp` add reverse-engineering implementation playbook

**Fixed**

- `security` split documentation scan scope
- `security` bound Codex component scope
- `security` use complete Codex component scans
- `security` size Codex budget for full scan

**Docs**

- refresh changelog

**Chores**

- `security` add ultimate assurance suite
- `security` add Codex Security scanning

## 2026-08-24

**Added**

- `managed-apps` add 9Router as a one-click managed app

**Fixed**

- `managed-apps` embed 9router existing domain
- `managed-apps` make 9router public-ip first
- harden security state and credential guards

## 2026-08-23

**Added**

- add interactive onboarding and skill market
- complete terminal and mobile app surfaces

**Fixed**

- `android` clear notch in app drawer
- `mobile` stabilize widgets back and viewport

**Changed**

- `ui` separate shell design systems

**Docs**

- refresh architecture and ChatGPT MCP guide

## 2026-08-22

**Fixed**

- `settings` adopt native iOS hierarchy
- `icons` align mobile platform artwork
- `responsive` harden mobile and landscape layouts
- `git` isolate push-gate test repositories
- `settings` improve MCP UI and activity scrolling

## 2026-08-21

**Added**

- `projects` add opt-in function capabilities

## 2026-08-20

**Added**

- `mcp` global project/skill discovery, drop image generation
- `mcp` import ChatGPT generated files
- `mcp` add provider-backed image generation

**Fixed**

- `mcp` lossless scan continuation and exact-id project resolution
- `mcp` one project validator, dirent budgets, resumable caps
- `mcp` contain, bound and uniquely identify project discovery
- `mcp` make ChatGPT file imports region agnostic
- `mcp` allow ChatGPT India South Central file storage
- `mcp` allow ChatGPT New Zealand file storage
- `mcp` allow ChatGPT Australia file storage
- `mcp` allow ChatGPT regional file storage
- `mcp` report rejected file host safely

## 2026-08-19

**Added**

- enable image generation and full access defaults
- `mcp` isolate workflows and standardize skill flows
- `mcp` streamline bootstrap and workflow visibility
- add semantic skill memory and workflow recipes
- add secure temporary screenshot links
- add MCP screenshots and live activity

**Fixed**

- `oauth` force visible ChatGPT callback
- `icons` use native macOS and Windows artwork
- `update` remove passwordless sudo requirement
- use official agent logos

## 2026-08-18

**Added**

- finish native platform icon set
- harden skills and refresh platform icons

**Fixed**

- use transparent feature icon artwork

## 2026-08-17

**Added**

- `settings` render the changelog as records in a scroll area, not injected markdown
- `update` a Check again row, so a release that lands while the panel is open is visible
- `files` long-press opens the context menu, so Preview is reachable on a phone
- `update` tell the running build from the checkout, so a pending rebuild is visible
- `settings,preview` update MSO from the app, and preview the formats a real disk has

**Fixed**

- `security` shell rc files hold API tokens — the credential denylist now says so
- `changelog` a regeneration commit must not appear in the file it regenerates
- `deps` pin nanoid >=3.3.18 — the audit gate has been failing on main
- `managed-apps` say why a dashboard is missing instead of silently opening a terminal
- `install` write the uid out — %U resolves to 0 for a User=<name> system unit
- `managed-apps` fail closed on an unreadable bus, and stop a retry eating the live venv
- `managed-apps` one-click install died, and installed apps read as "not installed", under systemd
- `install` bind loopback by default, and restart the service on re-run

**Changed**

- one download helper, one path helper, and gates for the drifts they hid

**Tests**

- `e2e` a committed browser check for Preview and the update panel
- `preview` one anchor the e2e can read on both surfaces

**Docs**

- `progress` record the codebase audit — what was duplicated, drifted, undefended
- record that connectors-gateway now consumes this MCP surface
- `readme` the update button, and what Preview actually opens
- plain http to an IP cannot complete a login — say so where it matters

## 2026-08-11

**Added**

- `ship` one command that changelogs, pushes, rebuilds and verifies
- `shells` Windows/iOS/Android to their 2026 specs, plus a backup for local state

**Fixed**

- `ship` amend on retry, and collapse a repeated subject in the changelog
- `ai` Codex DOES do tool calling — implement it instead of announcing it cannot
- `pwa,chat` notch clearance, a doubled iOS inset, and an assistant that was lying

**Tests**

- `e2e` a browser that actually loads the page — and the three bugs it found

**Docs**

- `progress` log the shell-spec pass, the springs, and the backup

## 2026-08-10

**Added**

- give Alfa the reach MCP has, and a gate so they cannot drift apart again
- `mcp` managed-app logs and lifecycle, tiered by blast radius not by layer
- `mcp` an MCP server so ChatGPT, Claude.ai or Cursor can drive this VPS

**Fixed**

- `cli` four missing verbs, a prod-breaking build, and a silently-wrong --base
- close the four cheap findings from the tool-surface parity audit
- `mcp` the audit trail was recording refused commands as successes
- `audit` stop a test run appending to the owner's forensic trail
- `mcp` record what an MCP token did — the trail it was bypassing
- `a11y,perf` name the dock icons, announce login errors, stop the resize storm
- `perf,ux` halve the boot API calls, unstick the dead chunk spinner, cut 9 orphans

**Faster**

- get the shell chrome and the Alfa catalog out of first load

**Changed**

- delete five retired subsystems nothing could reach

**Docs**

- `progress` log the three-surface parity audit and what it fixed
- `progress` log the MCP server and what was verified live
- cut five finished plans, trim PROGRESS's tail, log the audit follow-up

## 2026-08-04

**Fixed**

- `hydration` render the shell after mount — zero mismatches anywhere
- `hydration` kill 3 of 4 React #418 sources; mobile contrast + back labels
- `css` un-break every border-color utility, and make Android's Back visible

## 2026-08-03

**Added**

- `ci` real dependency + build gates, and fix the sharp CVE they caught
- migrate pnpm -> bun, and fix what the audit actually found
- `shell` Docs app, a state-aware dock, and quicklinks back to the owner
- `cli` print a paste-ready command under every device
- `cli` complete API coverage, doctor, completion, global options
- `cli` device pending + revoke all, per-command help, version
- `cli` add `mso` CLI + agent skills so the web UI is one frontend, not the product

**Fixed**

- `a11y` raise 4 mobile touch targets to the WCAG 24x24 floor
- `security` close 3 of 4 rm -rf bypasses, and stop a corrupt file wiping the device allowlist
- `cli` name the near-miss flag, and report what's left after a revoke
- `cli` make `device` a subcommand group and say what an unknown command was

**Faster**

- keep the OS shell out of every route, stop sleeping on every stats poll

**Changed**

- delete 836 net lines of metadata and dead exports nothing reads
- `quicklinks` owner's links become owner's data, repo keeps a neutral fallback
- rename os-vps -> mso across code, config and prod wiring

**Docs**

- reconcile every live doc against what the box actually does
- `progress` record the 2026-08-03 bun migration, audit and gate work

**Chores**

- drop the one-shot contrast tuner nothing invokes

## 2026-08-02

**Other**

- Initial commit
