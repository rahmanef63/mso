# iOS design.md

Source of truth: the project Apple-platform design reference (Apple HIG/Liquid Glass reference, 2026).

## Contract
- Clarity, deference, depth. Content is solid; glass belongs to navigation/overlays, never content cards.
- 16–20pt side margins, 4/8pt rhythm, continuous/concentric corners.
- SF-style system typography at the Large Dynamic Type size. Body and menu rows are 17/22 Regular (tracking −0.43). Navigation titles are Headline 17/22 Semibold. Home icon labels are Caption 1, 12/16 Regular. Screen titles such as Today are Title 1 emphasized, 28/34 Bold. The lock date is a short Footnote line (13/18 Regular) tight above the time. The lock time is 92pt Semibold (SF Pro tracking 0 at 92pt; Semibold is the Headline and emphasized Title 3 weight) in cream at about 78% opacity. Controls are at least 44×44pt and sit on a 16pt side margin.
- Root feature header: **`< Home`** left, feature title centered, AI icon right; 44pt minimum targets.
- Drill-down uses the same single header: parent on the left, detail title centered, AI right. Never render a second navigation header inside content.
- Settings: the MSO root contract keeps `Settings` in the centered shell bar, so the content begins with Search (no second large “Settings”). Use grouped inset cards, ~16–18pt radius, 50–52pt rows, inset separators, muted section labels, system-green switches.
- Forms/actions that interrupt flow use a bottom drawer/sheet. Keep destructive actions red and separated.
- Navigation/overlay materials may use glass; content cards remain solid.
- Home screen: page dots, then a small glass search pill (magnifying glass and the word Search), then a separate glass dock of app icons with no labels. Grid icons keep their labels. Each widget size is its own home screen: one purple placeholder (small, medium, large, or extra large) with app icons in the remaining cells. The lock screen sits on the shell wallpaper: a safe-area status bar (left empty when the installed PWA draws the system status bar), a short date, one 92pt Semibold cream time, then weather, activity rings, and a round clock, with a circular screen-light button and a keyboard-focusable 44pt unlock indicator. Clock, date, and timezone are the browser Date and Intl. Weather remains unavailable. This shell does not request geolocation or contact external weather providers; any future provider integration needs a separately reviewed explicit opt-in. Control Center is one packed glass mosaic. A home-icon long-press is a floating menu: Hide from Home, Lock screen, Edit Home Screen, then that app's own actions.
- Respect safe areas, Reduce Motion, Reduce Transparency and high contrast.

## Current acceptance boundary
The candidate preserves the existing iOS layout direction. Fidelity to the supplied Figma URL is unverified: its selected node is a keyboard sheet and full design context was unavailable. ENERGY 1 / RHYTHM 1 / MOTION 1: restrained utility chrome, consistent navigation, and only state transitions. The unavailable-weather state avoids fabricated readings; action labels describe the implemented privacy lock and local home visibility rather than biometrics or uninstalling apps. Non-iOS lock curtains retain their original layout and behavior.
