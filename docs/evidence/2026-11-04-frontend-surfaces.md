# Frontend surfaces handoff

Base: main 266c24cb. Branch: codex/frontend-surfaces-20261104. Draft candidate.

| Audit | Change | Verification still needed |
|---|---|---|
| PX-01/02 | Abort superseded infrastructure reads. Separate loading, empty and errors. Name Refresh and identify stale inventory. | Reverse delayed project and zone responses. Exercise 403, failed verification, retry and provider change. |
| PX-03 | Open. Native manager selection and Composio session identity remain separate. | Define a server-validated owner and connection binding for lookup, creation and cache reuse. Use synthetic owners and multiple connections before enabling it. |
| PX-04/05/06 | Associate Create App labels, expose selected swatches and wrap them. Keep nonsecret fields per window with close and reload guards. | Test label click and keyboard, 320px coarse, 200% text, remount and canceled discard. |
| PX-07 | Show an error when an n8n refresh fails and a prior embed remains. | Force network rejection after initial success, then retry. Verify denial clears the previous embed. |
| PX-08 | Show stale telemetry, last sample time and process failures. Ignore superseded poll results. | Test slow requests, hide/show, disconnect and recovery. |
| PX-09 | Bound Composio tools disclosure height and allow internal scroll. | Test 100 and 500 tools in short and narrow panes, with keyboard and larger text. |
| ST-01 | Write browser storage before publishing state. Show failure in Store confirmation or Create App. | Force quota failure and retry install, uninstall, feature toggle and creation. |
| ST-02 | Publish Skills catalog and discovery from one refresh generation. Serialize writes. | Reverse response order and test concurrent extension events during a mutation. |
| ST-03 | Keep recovery guidance visible when the external frame finishes loading. | Test framing denial, timeout and open-in-new-tab across connected apps and n8n. |

State belongs to the existing browser registry, exact window, or current request. External frames retain their origin and sandbox settings. The UI keeps the existing owner checks.

TypeScript, architecture and changed-file lint are the scoped checks for this candidate. Full local build and browser journeys, security preflight and remote checks are pending for the next agent. Run the repository gates on the committed SHA before promoting the draft. Roll back by reverting this package's commit.
