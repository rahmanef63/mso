# Android design.md

Design family: Material 3 / Material You.

## Contract
- Google Sans/Roboto family, dynamic/tonal surfaces, Material elevation and state layers.
- Root feature header: **`< Home`** left, feature title centered, AI icon right; minimum 48dp touch targets.
- Drill-down uses one top app bar; parent replaces Home. Never stack an app-owned navigation bar under it.
- Prefer 16–28dp rounded containers, tonal fills, pill/segmented controls where appropriate.
- Settings/list surfaces use Material list rows and section spacing, not iOS grouped-list styling.
- Modal mobile flows use Material bottom sheets/drawers; destructive confirmations remain explicit.
- Use M3 motion tokens/springs already defined by the Android shell and honor Reduce Motion.
- Bottom system navigation remains shell-owned; feature navigation must not duplicate Android Back.
