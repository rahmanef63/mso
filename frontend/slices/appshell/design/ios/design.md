# iOS design.md

Source of truth: the project Apple-platform design reference (Apple HIG/Liquid Glass reference, 2026).

## Contract
- Clarity, deference, depth. Content is solid; glass belongs to navigation/overlays, never content cards.
- 16–20pt side margins, 4/8pt rhythm, continuous/concentric corners.
- SF-style system typography; body 17pt, navigation title 17pt semibold. Large titles are allowed inside feature content only when they do not duplicate the shell-owned centered root title.
- Root feature header: **`< Home`** left, feature title centered, AI icon right; 44pt minimum targets.
- Drill-down uses the same single header: parent on the left, detail title centered, AI right. Never render a second navigation header inside content.
- Settings: the MSO root contract keeps `Settings` in the centered shell bar, so the content begins with Search (no second large “Settings”). Use grouped inset cards, ~16–18pt radius, 50–52pt rows, inset separators, muted section labels, system-green switches.
- Forms/actions that interrupt flow use a bottom drawer/sheet. Keep destructive actions red and separated.
- Navigation/overlay materials may use glass; content cards remain solid.
- Home screen: page dots, then a small glass search pill (magnifying glass and the word Search), then a separate glass dock of app icons with no labels. Grid icons keep their labels. Each widget size is its own home screen: one purple placeholder (small, medium, large, or extra large) with app icons in the remaining cells. Lock screen type is light on the wallpaper: a small date and one large time, with circular glass flashlight and camera buttons. Control Center is one packed glass mosaic. A home-icon long-press is a floating menu: Remove App, Require Face ID, Edit Home Screen, then that app's own actions.
- Respect safe areas, Reduce Motion, Reduce Transparency and high contrast.
