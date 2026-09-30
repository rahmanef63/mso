#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";

const cli = process.env.MSO_CLI || "mso";
const result = spawnSync(cli, ["a2a", "trace", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env
});

if (result.error) {
  process.stderr.write("a2a: MSO CLI is unavailable. Install/connect MSO or use the native MSO MCP workflow tools.\n");
  process.exitCode = 127;
} else {
  process.exitCode = result.status == null ? 1 : result.status;
}
