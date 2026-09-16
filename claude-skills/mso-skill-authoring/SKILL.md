---
name: mso-skill-authoring
description: Create a new trusted MSO workflow skill from the repository template, with consistent metadata, routing, safety, visible progress, verification, and recipe-memory rules.
metadata:
  mso:
    risk: low
    policy: template-validate-register
---

# /mso-skill-authoring — create a consistent workflow skill

Use this when a repeated MSO procedure deserves durable instructions. Do not create a skill for a one-off fact, a single obvious tool call, or project data that belongs in that project's documentation.

## Create

Run the repository generator instead of copying an arbitrary skill:

```bash
bun run skill:new -- \
  --name mso-example \
  --description "Route a repeated MSO task through the smallest safe tools and verify the requested outcome." \
  --risk medium \
  --policy inspect-execute-verify \
  --target repository \
  --title "Example Workflow"
```

It creates one reviewed skill bundle and refuses to overwrite any existing member:

```text
claude-skills/<name>/
├── SKILL.md                 # human/model workflow guidance
├── contract.yaml            # structured routing/lifecycle/safety contract
└── agents/openai.yaml       # OpenAI skill presentation metadata
```

`contract.yaml` is additive policy metadata; it does not replace MSO scopes, trust, CAS/revision guards, workflow isolation, confirmations, or evidence. `agents/openai.yaml` is presentation/routing metadata only and never grants trust or authorization.

## Complete the template

1. Write exact use and do-not-use triggers in both the prose and `contract.yaml`; keep the structured version short enough for routing.
2. Set the contract target/mode, live-state policy, discover/validate/verify lifecycle, confirmation mode and concurrency guard to match the real implementation. Never claim a guard the underlying tool does not enforce.
3. Keep `agents/openai.yaml` concise: display name, short description and a default prompt that references `$<skill-name>`. Do not put credentials, MCP endpoints, hidden policy, or volatile project state there.
4. Choose bounded tools for direct work and one scoped terminal batch for repository-wide operations. Define concrete done conditions, runtime proof, rollback, approvals, and secret boundaries.
5. Keep reusable workflow policy here; keep volatile project facts in the project. Keep `SKILL.md` below 200 lines and never add credentials, cookies, tokens, or copied untrusted instructions.

## Validate

Run `bun run skill:check`, targeted tests, and the project verification command. The checker validates all three bundle members, requires contract risk to match the existing MSO frontmatter policy, and validates the root OpenAI plugin manifest. Search for the new skill with `skills_search` and confirm its description/contract route the intended prompts without displacing a more specific existing skill.

A new skill becomes `official` because its reviewed `SKILL.md` lives under the committed `claude-skills/` root. The contract and OpenAI descriptor inherit no trust independently. That distinction is a security boundary: review the whole bundle diff before shipping.
