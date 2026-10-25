# jdecked/twemoji

| | |
|---|---|
| License | MIT (code) + CC-BY 4.0 (SVG assets) |
| Pin | `15.1.0` via jsDelivr |
| Relation | emoji rendering in the icon picker |
| Code copied | converter logic reimplemented; assets hot-linked |

## What MSO uses

`frontend/slices/icon-picker/lib/twemoji.ts` converts a Unicode emoji to a Twemoji
codepoint filename and builds a jsDelivr URL against
`cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0`. No emoji package is added to
`package.json`, so nothing is bundled or redistributed.

## Attribution

The file header states the attribution and dual license, and states why the actively
maintained fork is used instead of the archived original. CC-BY 4.0 requires
attribution when the SVG assets are redistributed; MSO serves them from the CDN and
keeps the credit in the source file.
