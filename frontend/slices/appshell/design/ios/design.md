# iOS design.md

Source of truth: the project Apple-platform design reference (Apple HIG/Liquid Glass reference, 2026).

## Contract
- Clarity, deference, depth. Content is solid; glass belongs to navigation/overlays, never content cards.
- 16–20pt side margins, 4/8pt rhythm, continuous/concentric corners.
- SF-style system typography at the Large Dynamic Type size. Body and menu rows are 17/22 Regular (tracking −0.43). Navigation titles are Headline 17/22 Semibold. Home icon labels are Caption 1, 12/16 Regular. Screen titles such as Today are Title 1 emphasized, 28/34 Bold. The lock date is Title 3 emphasized, 20/25 Semibold, tracking +0.38; the lock time is 96pt Regular with the 96pt tracking of 0. Controls are at least 44×44pt and sit on a 16pt side margin.
- Root feature header: **`< Home`** left, feature title centered, AI icon right; 44pt minimum targets.
- Drill-down uses the same single header: parent on the left, detail title centered, AI right. Never render a second navigation header inside content.
- Settings: the MSO root contract keeps `Settings` in the centered shell bar, so the content begins with Search (no second large “Settings”). Use grouped inset cards, ~16–18pt radius, 50–52pt rows, inset separators, muted section labels, system-green switches.
- Forms/actions that interrupt flow use a bottom drawer/sheet. Keep destructive actions red and separated.
- Navigation/overlay materials may use glass; content cards remain solid.
- Home screen: page dots, then a small glass search pill (magnifying glass and the word Search), then a separate glass dock of app icons with no labels. Grid icons keep their labels. Each widget size is its own home screen: one purple placeholder (small, medium, large, or extra large) with app icons in the remaining cells. The lock screen sits on the shell wallpaper: a safe-area status bar (left empty when the installed PWA draws the system status bar), the Title 3 date, one 96pt time, then weather, activity rings, and a round clock, with circular glass flashlight and camera buttons and the home indicator. Clock, date, and timezone are the browser Date and Intl. Weather asks for the device location and requests conditions from the client; a denial stays a quiet fallback. Control Center is one packed glass mosaic. A home-icon long-press is a floating menu: Remove App, Require Face ID, Edit Home Screen, then that app's own actions.
- Respect safe areas, Reduce Motion, Reduce Transparency and high contrast.
