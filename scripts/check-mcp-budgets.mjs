#!/usr/bin/env node
// Repeatable release check; byte counts are not tokenizer counts.
import { spawnSync } from "node:child_process";
const run = spawnSync("bun", ["run", "test", "lib/mcp/client-budgets.test.ts", "lib/mcp/chatgpt-profile.test.ts"], { stdio: "inherit", env: { ...process.env, MSO_PROFILE_METRICS: "1" } });
process.exit(run.status ?? 1);
