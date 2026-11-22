# Shell and picker audit implementation, 2026-11-04

Source: shell audit SH01–SH14, base 266c24cb. Development worktree only;
no deployed runtime or authenticated data was changed. Shell, feature and UI-kit
ownership follows the frontend contract. Browser and device acceptance remains open.

| ID | Before → change | Owner / source | Evidence and remaining limits |
|---|---|---|---|
| SH01 | Inactive tabs unreachable → roving arrows and Home/End, unique IDs | Image picker, image-picker-dialog.tsx | Source change; modal/drawer keyboard test needed |
| SH02 | Hidden chooser inaccessible → native button invokes file input | Image picker, upload-tab.tsx | Source change; keyboard chooser test needed |
| SH03 | Clipboard reported success on rejection → await result, retain panel and manual copy | AppShell clipboard | Unit test covers reject, missing API and success; browser permission test needed |
| SH04 | Broken links accepted → error, timeout, request identity and label | Image picker, link-tab.tsx | Source change; browser load, timeout and close test needed |
| SH05 | Coarse palette clipped → wrap colors and let pills grow | Icon picker, ColorRow.tsx and Toolbar.tsx | Geometry on 320/390/768, 200% zoom and both themes unverified |
| SH06 | Sidebar fixed width → inherited feature token | AppShell app-chrome.tsx and Settings settings-shell.tsx | Token adoption implemented; five-shell override/portal proof needed |
| SH07 | Mount-local Settings state → window-scoped section and nonsecret provider fields, discard and close/reload guard | Settings app.tsx, window-context.ts, custom-provider-form.tsx | Partial: API key/JSON remain local and are guarded on section navigation, but a shell remount can discard them without warning; deep-link, isolation and remount journeys unverified |
| SH08 | Overlays had no modal boundary → existing ResponsiveDialog for Clipboard, Shortcuts and Spotlight | AppShell feature components | Focus containment, opener restoration, stacking and native drawer behavior need browser proof |
| SH09 | Clipboard actions hover-only → focus-within and coarse visibility | Clipboard panel | Keyboard and touch proof needed |
| SH10 | Picker dialog unnamed → accessible title | IconPicker.tsx | Drawer and dialog accessible-name proof needed |
| SH11 | Preset failure blank and rejected promise cached → error, Retry and reset pending on rejection | Settings theme-section.tsx and appearance registry.ts | Registry failure then retry unit test passes; chunk retry in browser unverified |
| SH12 | Dialog close too small on coarse input → 44px target and title clearance | UI kit dialog.tsx | Measured target, title overlap and both themes unverified |
| SH13 | Invalid replacement retained old upload → clear selection and preview before validation | Image picker upload-tab.tsx | Type and size replacement browser test needed |
| SH14 | Native button keyboard click did not open → keyboard click activates; deletion scoped to focused desktop icon | AppShell desktop-icons.tsx | Pointer drag, app/file/link and editable focus behavior need browser proof |

State lifetime: Settings nonsecret fields and section use the exact-window in-memory
feature store and are cleared with the window. API key and pasted JSON never enter
that store. A browser reload is not draft persistence. Secrets are component-local.

Verification on this worktree: targeted clipboard, settings section and registry
tests: 9 passed; changed-file ESLint and typecheck passed. Architecture initially
failed the file length ratchet, then passed without raising the limit. Contrast:
36 presets in both modes and globals, zero failures. No full build, preflight,
security scan, CI, real-device, screen-reader or rendered five-shell checks.

Next integration agent: rerun `umask 077; VITEST_MAX_WORKERS=2 bun run test`
with targeted picker/overlay tests, `bun run typecheck`, `node scripts/check-architecture.mjs`,
`node scripts/check-contrast.mjs`, and mandated local/security/remote gates.
Exercise SH01–14 in the actual five shells and both themes before marking ready.
