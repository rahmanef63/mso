# macOS design.md

Source: [macOS 27 Examples](https://www.figma.com/design/f3ivRnEohVvr87qszwuQiw/macOS-27--Community-?node-id=121-18094).

## Component selection
- Reference nodes: menus 4440:8154/8155, windows 4440:8164/8165, unified titlebar 4440:8159.
- Candidate A 5cdad278 supplies 34px bar geometry, solid 52px titlebar, 16px windows, 14px traffic lights inside 24px targets, and focus-dependent shadows.
- PR103 candidate B 5efbe7ea supplies the direction for semibold/heavy bar labels, 24px fine-pointer context rows and translucent menu material.
- Browser inspection of Examples/Menubar `4370:42756` confirms SF Pro Medium 13px labels and shortcut symbols. The shared `.macos-menu` rule owns size/weight for menu-bar, context and submenu rows; portaled panels use the existing `data-shell-id` font stack instead of a separate system-ui override. Platform font fallback remains intentional where SF Pro is unavailable.
- Browser inspection of the active Glass Effect confirms a 12px radius and 0.5px Plus Lighter inner edge; its fallback shadow is 0 8px 48px at 25%. Native refraction/dispersion are approximated with the existing blur token, saturation and a thin CSS highlight. The shared macOS rule owns material for dropdown, context and submenu panels; reduced glass disables both standard and WebKit filters. Existing readable light/dark backgrounds, geometry and targets stay authoritative.
- Combined menus retain A's readable shortcut text and selection contrast. Coarse-pointer rows remain at least 44px; Windows and Dashboard metrics retain their existing values.
- Existing Radix controls, shell store, app registry and docking interactions remain authoritative.
- The Examples page has no dock specimen. Preserve existing artwork; reserve the full hover-growth pool so controls stay reachable.
- macOS CSS loads with its lazy shell component. No global palette replacement or extra design dependency.
- Do not import PR103's unrelated iOS/chat modifications or unconditional Force Quit styling.

## Newer wallpaper direction
Canonical commit 998632c8 refreshes the user-requested light/dark WebP defaults.
Preserve that newer project behavior rather than masking it with A's Figma PNG override.
The supplied Figma screenshots remain chrome references; wallpaper is an intentional difference.
Custom/live and per-shell wallpaper preferences retain canonical precedence.

## Accessibility and behavior
ENERGY 1 / RHYTHM 1 / MOTION 1: compact system chrome for server operators.
White bar text uses a dark scrim so custom backgrounds remain legible.
Status labels and links inherit bar-specific text tokens, without recoloring app content.
Window minimization clears its exit phase before restoration; dock clicks reuse existing windows.
Viewports up to 500px tall use a compact 32px titlebar, preserving 24px controls and usable app content.
App content retains its existing structure, data and permissions.

## Verification
Reproduce scoped desktop/light/dark/mobile/keyboard checks with scripts/e2e/macos-figma.mjs.
Static declarations do not establish browser geometry: measure settled animation states and visible hit targets.
Merge requires the exact candidate's required tests, build, budget, security gates and independent review.
Known dependency audit failures must not be suppressed or treated as cosmetic.
