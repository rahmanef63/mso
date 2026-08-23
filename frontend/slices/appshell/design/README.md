# Shell UI architecture

MSO has one behavior model and multiple presentation systems.

- **Shared/headless:** API calls, persistence, settings values, function-calling, stores, validators, data loaders, app actions.
- **Shell-specific:** navigation chrome, typography, spacing, cards/list treatment, dialog/drawer presentation, motion and desktop window chrome.
- Feature code must not fork business logic by OS. A feature may publish presentation state (for example a mobile detail title/back action), while the shell renders it.
- Every shell has a local `design.md`. Code that changes a shell-specific visual rule should update/read that document first.
- Mobile feature navigation is shell-owned. Root contract: **`< Home` | centered feature title | AI**. Drill-down replaces `Home` with the parent label but does not add a second header.
- Dialogs/forms use `ResponsiveDialog`/`FormDrawer`; the active `ShellDesignProfile` chooses the native mobile presentation unless a feature explicitly overrides it.
