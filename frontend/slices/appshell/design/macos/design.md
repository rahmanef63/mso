# macOS design.md

Source family: `rahmanef63/apple-os-shell/uploads/design.md`, macOS sections.

## Contract
- Desktop-first, compact density, SF typography, translucent navigation/sidebar layers with solid content.
- Windows use native title-bar semantics, traffic lights, subtle depth and ~10px window radius.
- Prefer sidebar + detail for System Settings; selection is persistent while content scrolls independently.
- Toolbars are compact and contextual. Avoid iOS large-title/grouped-page treatment in desktop windows.
- Modal workflows use centered dialogs; long secondary workflows may use side panels/sheets.
- Do not stack glass surfaces. Sidebars/toolbars can be glass; tables/cards/content stay solid.
- Keep keyboard, pointer, focus, hover, resizable-window behavior first-class.
