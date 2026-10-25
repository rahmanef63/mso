# termux/proot-distro

| | |
|---|---|
| License | GPL-3.0 |
| Relation | prerequisite for MSO on Android |
| Code copied | none |

## What MSO uses

Documentation only. [`../TERMUX.md`](../TERMUX.md) states that MSO is not installed
into native Android/Termux because Bun does not target Android, and that the supported
path is an Ubuntu PRoot environment provided by proot-distro. The link points at the
upstream repository.

## License boundary

GPL-3.0 applies to proot-distro, which the user installs independently from its own
source. MSO does not bundle, patch, link or distribute it. A future MSO-bundled install
path that ships proot-distro binaries would need a GPL compliance review.
