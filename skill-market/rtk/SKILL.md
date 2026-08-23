---
name: rtk
description: Use RTK (Rust Token Killer) when it is already installed to compress verbose shell output and reduce agent context usage. Prefer RTK for read-heavy git, search, listing, test, lint, build, docker and package-manager output when full raw output is not required. Never install RTK, run remote install scripts, edit shell profiles, or enable global hooks unless the user explicitly asks for that separate system change.
homepage: https://github.com/rtk-ai/rtk
license: MIT
---

# RTK — safe MSO integration

Use RTK as an output filter when `command -v rtk` succeeds. It can substantially reduce verbose command output before it reaches an agent context.

## Use

Prefer RTK for read-heavy commands where compressed output preserves the answer, for example:

- `rtk git status`, `rtk git diff`, `rtk git log`;
- `rtk grep`, `rtk find`, `rtk ls`, `rtk read`;
- `rtk test ...`, `rtk vitest`, `rtk pytest`;
- `rtk tsc`, `rtk lint`, `rtk next build`;
- `rtk docker ...` and supported package-manager commands.

Use the raw command instead when exact/full output matters, especially interactive commands, security debugging, failed installs, destructive operations, or output that will be parsed by another command.

## Installation boundary

This skill does **not** authorize installing RTK. If `rtk` is missing, say so and continue with normal commands. Only install RTK when the user explicitly asks to install the binary, and use a pinned/reviewable package or release path rather than an unpinned `curl | sh` pipeline.

Do not edit `.bashrc`, `.zshrc`, `.profile`, agent hooks, or global command-rewrite configuration merely because this skill is active.

## Verify savings

When RTK is installed and the user asks about savings, `rtk gain` is the appropriate report.
