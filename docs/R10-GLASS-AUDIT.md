# R-10 glass dose audit

Point in time audit of the antislop R-10 rule across the MSO shell, app and settings
surfaces. It records what the code did at the audited commit, the one genuine breach
found, and the fix that closes it.

## The rule

> **R-10 glassmorphism dose cap:** at most 1 to 2 simultaneous blurred surfaces per
> screen.

A "blurred surface" is any element that resolves to a `backdrop-filter` blur, either
through a `backdrop-blur-*` utility or through the shared `.glass` helper
(`app/globals.css:237`). A "screen" is one shell surface at one moment. Persistent
chrome counts. A transient overlay counts its own blurred layers plus any persistent
chrome it does not fully occlude.

## Inventory

Generated from `grep -rn "backdrop-blur"` over the repository: 40 occurrences in 34
files. Every occurrence is listed. Line numbers are as of the audited commit and did
not move with the fix.

| File | Element | Shell | Persistent or transient | Verdict |
|---|---|---|---|---|
| `frontend/slices/appshell/components/app-launcher.tsx:54` | Launcher search pill | macOS | transient | OK, 2 with the launcher surface |
| `frontend/slices/appshell/components/mobile-app-library.tsx:65` | App Library search field | iOS | transient (library page) | OK, single surface |
| `frontend/slices/appshell/components/mobile-app-library.tsx:89` | Folder open scrim | iOS | transient | OK, 2 with search field |
| `frontend/slices/appshell/components/shells/android/android-parts.tsx:28` | NavBar row | android | persistent | OK, 2 with home search pill |
| `frontend/slices/appshell/components/shells/android/android-parts.tsx:65` | Recents overlay | android | transient | OK, covers NavBar |
| `frontend/slices/appshell/components/shells/android/android-parts.tsx:172` | App Drawer | android | transient | OK, covers NavBar |
| `frontend/slices/appshell/components/shells/android/android-shell.tsx:166` | Home search pill | android | persistent | OK, 2 with NavBar |
| `frontend/slices/appshell/components/shells/context-menu-parts.tsx:15` | Context menu panel | all | transient | OK, one menu at a time |
| `frontend/slices/appshell/components/shells/dashboard/dashboard-shell.tsx:92` | Dashboard shell canvas | dashboard | persistent | OK, shell surface itself |
| `frontend/slices/appshell/components/shells/window-overview.tsx:35` | Mission Control / Task View | macOS, windows | transient | OK, covers the desktop chrome |
| `frontend/slices/appshell/components/shells/windows/run-dialog.tsx:73` | Comment only, dialog is deliberately solid | windows | n/a | OK, no blur |
| `frontend/slices/appshell/components/shells/windows/snap-assist.tsx:60` | Snap assist full screen backdrop | windows | transient | **BREACH** |
| `frontend/slices/appshell/components/shells/windows/snap-assist.tsx:64` | Snap zone panel | windows | transient | OK, keep |
| `frontend/slices/appshell/components/shells/windows/start-menu.tsx:54` | Start menu panel | windows | transient | OK, 2 with taskbar |
| `frontend/slices/appshell/components/shells/windows/taskbar.tsx:62` | Taskbar | windows | persistent | OK, persistent chrome |
| `frontend/slices/appshell/features/control-center/components/control-center.tsx:28` | Control Center sheet (apple family) | iOS | transient | OK, single surface |
| `frontend/slices/appshell/features/inspector/components/alfa-sheet.tsx:38` | Alfa sheet scrim | mobile | transient | OK, single surface |
| `frontend/slices/appshell/features/inspector/components/inspector.tsx:30` | Inspector dock | desktop | persistent | OK, second persistent surface |
| `frontend/slices/appshell/features/lock-screen/components/ios-lock.test.tsx:44` | Assertion that the lock screen has no blur | iOS | n/a | OK, test string |
| `frontend/slices/appshell/features/lock-screen/components/lock-screen.tsx:66` | Lock curtain (non iOS) | mobile | transient | OK, covers everything |
| `frontend/slices/appshell/features/widgets/components/mobile-widgets.tsx:46` | Today Edit pill (apple) | iOS | persistent (Today page) | OK, page chrome |
| `frontend/slices/appshell/features/widgets/components/mobile-widgets.tsx:47` | Today Edit pill (android) | android | persistent (Today page) | OK, page chrome |
| `frontend/slices/appshell/features/widgets/components/widget-cards.tsx:33` | Widget card surface | desktop, mobile | persistent | OK, app content, see limits |
| `frontend/slices/auth/components/auth-gate.tsx:43` | Guided demo card | demo | transient | OK, single surface |
| `frontend/slices/files-manager/components/drop-overlay.tsx:8` | Drop to upload overlay | apps | transient | OK, drag only, inside one window |
| `frontend/slices/image-editor/components/stage/stage-overlays.tsx:61` | First run hint | apps | transient | OK, 2 with zoom HUD |
| `frontend/slices/image-editor/components/stage/zoom-hud.tsx:28` | Zoom HUD | apps | persistent (editor open) | OK, app content |
| `frontend/slices/media-viewer/components/audio-player.tsx:22` | Audio player card | apps | persistent (app open) | OK, app content |
| `frontend/slices/media-viewer/components/fallback-card.tsx:26` | Unsupported file card | apps | persistent (shown) | OK, app content |
| `frontend/slices/media-viewer/components/remote-view.tsx:151` | Remote audio card | apps | persistent (shown) | OK, app content |
| `frontend/slices/media-viewer/components/remote-view.tsx:187` | Page turn arrows | apps | persistent (paging) | OK, app content |
| `frontend/slices/media-viewer/components/transport.tsx:26` | Play/pause button | apps | persistent | OK, app content |
| `frontend/slices/media-viewer/components/video-player.tsx:27` | Transport bar | apps | persistent | OK, app content |
| `frontend/slices/media-viewer/components/viewer-toolbar.tsx:54` | Viewer header | apps | persistent | OK, app content |
| `frontend/slices/organization/components/organization-view.tsx:152` | Seat inspector popover | apps | transient | OK, single surface |
| `frontend/slices/os-settings/components/changelog-view.tsx:27` | Sticky day header | settings | persistent (while scrolling) | OK, 2 with settings toolbar |
| `frontend/slices/os-shell/server-connection-status.tsx:42` | Mobile status pill | mobile | persistent | OK, single surface |
| `frontend/slices/reel-editor/components/render-overlay.tsx:23` | Render progress dialog | apps | transient | OK, single surface |
| `lib/infra/connection-ui-style.ts:60` | Settings mobile toolbar CSS | settings | persistent | OK, second surface in settings |
| `lib/presentation/widget-tokens.ts:89` | `--settings-backdrop-blur` token definition | all | n/a | OK, value definition |

## Per screen verdicts

Shell chrome rows are the ones that describe a shell surface at one moment. App
content surfaces (viewer controls, editor HUDs) plus the settings, mobile overlay and
demo rows are separated below, because a single app may legitimately own several
stacked content controls.

| Screen group | Shell | Blurred surfaces | Count |
|---|---|---|---|
| Desktop idle | windows | taskbar | 1 |
| Desktop with Inspector open | windows | taskbar, inspector | 2 |
| Start menu open | windows | start menu, taskbar | 2 |
| Context menu open | windows | menu panel, taskbar | 2 |
| Task View open | windows | task view overlay | 1 |
| Run dialog open | windows | dialog is solid, taskbar behind it | 1 |
| Snap assist open | windows | backdrop, panel, taskbar | **3** |
| Desktop idle | macos | menu bar and dock via `.glass`, outside this inventory | 2 |
| Mission Control | macos | overview | 1 |
| App Launcher | macos | launcher via `.glass`, search pill | 2 |
| Home page | ios | none in this inventory | 0 |
| App Library | ios | search field | 1 |
| App Library with folder open | ios | folder scrim, search field | 2 |
| Control Center | ios | sheet | 1 |
| Lock screen | ios | lock curtain | 1 |
| Home | android | search pill, NavBar | 2 |
| App drawer | android | drawer | 1 |
| Recents | android | recents overlay | 1 |
| Dashboard | dashboard | shell canvas | 1 |
| Image editor | apps | first run hint, zoom HUD | 2 |
| Media viewer, image or audio | apps | header plus one control | 2 |
| Media viewer, video | apps | header, transport bar, play button | 3, app content, see limits |
| Files manager drag | apps | drop overlay | 1 |
| Reel editor render | apps | dialog | 1 |
| Organization seat detail | apps | popover | 1 |
| Settings changelog | settings | sticky day header, mobile toolbar | 2 |
| Alfa sheet | mobile | scrim | 1 |
| Demo gate | demo | demo card | 1 |
| Mobile status pill | mobile | pill | 1 |

Counted from the table above, at the audited commit. 29 screens in total: 19 are
shell chrome, 6 are app content surfaces, and 4 are the settings changelog, the Alfa
sheet, the demo gate and the mobile status pill.

Shell chrome screens:

- **10 screens carry exactly 1 simultaneous blurred surface** (windows desktop idle,
  Task View, Run dialog, macOS Mission Control, iOS App Library, iOS Control Center,
  iOS lock screen, android app drawer, android Recents, Dashboard).
- **7 screens carry exactly 2.** That is the cap, and it is compliant: windows desktop
  with the Inspector open, Start menu, context menu, macOS desktop idle (menu bar and
  dock), macOS App Launcher (launcher and search pill), iOS App Library with a folder
  open, android home (search pill and NavBar).
- **1 screen carried 3: snap assist**, from the backdrop, the panel and the visible
  taskbar. This is the breach.
- **1 screen carries 0: the iOS home page**, which has no blurred element in this
  inventory.

App content surfaces, audited but out of scope for the fix:

- 3 screens carry 1 (files manager drag overlay, reel editor render dialog,
  organization seat popover).
- 2 screens carry 2 (image editor hint plus zoom HUD, media viewer header plus one
  control).
- **1 screen carries 3: the video media viewer**, from its header, transport bar and
  stage play button. These are content controls inside one app, not shell chrome.
  Recorded here for honesty and left unchanged.

The remaining four screens are the settings changelog (2), the Alfa sheet (1), the
demo gate (1) and the mobile status pill (1).

Shell chrome therefore complies everywhere except snap assist. After the fix snap
assist drops to 2 and the chrome total becomes 10 screens at 1 and 8 at 2, with no
chrome screen above the cap.

## The breach

`frontend/slices/appshell/components/shells/windows/snap-assist.tsx` was the only
breach. One interaction owned two glass layers:

- line 60, `absolute inset-0 z-[55] bg-black/30 backdrop-blur-[2px]`: the full screen
  backdrop, whose only job is to dim the desktop behind the panel.
- line 64, `absolute flex flex-col gap-3 overflow-auto rounded-2xl border border-white/15 bg-card/70 p-4 shadow-2xl backdrop-blur-xl`:
  the snap zone panel itself.

The taskbar check matters here. Snap assist is rendered by
`frontend/slices/appshell/components/shells/windows/windows-shell.tsx:90` and the
taskbar by line 91. Both are siblings in the same stacking context, taskbar at
`z-[60]` and snap assist at `z-[55]`, so **the taskbar paints on top of the snap
assist backdrop and is genuinely visible during snap assist**. The panel cannot hide
it either: `snapRect` bounds its height by `workArea`, which subtracts the taskbar
inset set at `windows-shell.tsx:38`. That screen therefore had **three** simultaneous
blurred surfaces: taskbar, backdrop, panel.

The backdrop is the correct element to make opaque, because the panel is the content
of the moment and the taskbar is separate persistent chrome that must not be stripped.

Fix applied in the next commit: the backdrop becomes a solid dim, `bg-black/40`, with
no `backdrop-filter`. The panel keeps `backdrop-blur-xl`, every z-index is unchanged,
the click to dismiss handler is unchanged, and the `animate-in fade-in duration-150`
entry animation is unchanged. That screen goes from 3 surfaces to 2, which is the
allowed dose.

## What was deliberately not changed

- Taskbar (`windows/taskbar.tsx:62`) and Inspector (`inspector.tsx:30`) both keep
  their blur. They are the two persistent chrome surfaces, and 2 is the cap.
- Every transient overlay in the inventory is the single glass surface of its own
  moment, or pairs with persistent chrome at exactly 2. Stripping any of them would
  be a regression, not a fix.
- No layout, spacing, radius, shadow or z-index moved. `scripts/check-contrast.mjs`
  and `scripts/verify-build.sh` were not modified.

## Limits of this audit

- `.glass` (`app/globals.css:237`) also produces `backdrop-filter: blur` and is
  outside the 40 occurrence inventory. It is used by the macOS menu bar and dock (2
  on the desktop), notification center, app switcher, mobile notifications, mobile
  switcher, iOS home chrome and folder cards, all of which are one surface per
  moment. `--blur: 0px` under `.reduce-glass` (`app/globals.css:168`) removes it.
- App content can stack more than two blurred controls inside one app: the video
  media viewer shows header, transport bar and play button together, and a widget
  stack shows one card per enabled widget. These are content surfaces, not shell
  chrome, they predate this audit, and they are left unchanged. Adding them to the
  cap would need an owner decision on whether "surface" means chrome or any blurred
  element.
