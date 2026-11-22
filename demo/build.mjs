import { spawnSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));

rmSync(path("./public"), { recursive: true, force: true });
cpSync(path("../public"), path("./public"), { recursive: true });

const build = spawnSync(process.execPath, [
  path("../node_modules/next/dist/bin/next"), "build", path("./"),
], {
  stdio: "inherit",
  env: { ...process.env, NEXT_PUBLIC_OS_DEMO: "1", NEXT_TELEMETRY_DISABLED: "1" },
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

if (!existsSync(path("./out/index.html")) || existsSync(path("./out/api"))) {
  throw new Error("Expected an exported demo with an index page and no API directory");
}
