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

## Real-device navigation
- On an actual narrow Android handset, do not draw a second simulated 3-button system navigation bar; the device/browser already owns that system chrome.
- MSO internal layers publish same-URL history entries so Android/browser Back closes All Apps, a detail view, or the current MSO app before leaving the shell.
- The simulated Back/Home/Recents row is reserved for the desktop PhoneFrame preview where no real Android system navigation exists.

## Widgets
- Mobile widgets use the active mobile surface. The Shell widget offers iOS/Android on mobile and desktop personas only on desktop.
- Widget stacks scroll vertically only; cards, Quicklinks, and Quick open grids must never widen the Today/Widgets viewport.
