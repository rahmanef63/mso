import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));

rmSync(path("./public"), { recursive: true, force: true });
cpSync(path("../public"), path("./public"), { recursive: true });

const build = spawnSync(process.execPath, [
  path("../node_modules/next/dist/bin/next"), "build", path("./"),
], {
  stdio: "inherit",
  env: {
    ...process.env,
    // Next runs from demo/, but the UI classes live in the shared repository.
    MSO_DEMO_SOURCE_ROOT: path("../"),
    NEXT_PUBLIC_OS_DEMO: "1",
    NEXT_TELEMETRY_DISABLED: "1",
  },
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

if (!existsSync(path("./out/index.html")) || existsSync(path("./out/api"))) {
  throw new Error("Expected an exported demo with an index page and no API directory");
}

const assets = path("./out/_next/static");
const styles = readdirSync(assets, { recursive: true }).filter((file) => file.endsWith(".css"));
if (!styles.some((file) => /\.sr-only\s*[{,]/.test(readFileSync(join(assets, file), "utf8")))) {
  throw new Error("The static export is missing the shell's Tailwind utilities");
}
