import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function readTrustedPackage(packagePath) {
  let handle;
  try {
    handle = await fs.open(packagePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    if (error?.code === "ELOOP") throw new Error("unsafe_sc_package");
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 65536 || (stat.mode & 0o022)) throw new Error("unsafe_sc_package");
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}

/** Inspect the declared package/bin identity without executing an unrelated `sc` program. */
export async function inspectScInstallation(candidate) {
  const bin = await fs.realpath(candidate);
  const binStat = await fs.stat(bin);
  if (!binStat.isFile() || (binStat.mode & 0o022)) throw new Error("unsafe_sc_binary");
  let directory = path.dirname(bin);
  for (let depth = 0; depth < 6; depth++) {
    const packagePath = path.join(directory, "package.json");
    const pkg = await readTrustedPackage(packagePath);
    if (pkg) {
      if (pkg.name !== "si-coder-agent" || typeof pkg.version !== "string" || typeof pkg.bin?.sc !== "string") throw new Error("not_si_coder");
      const declared = await fs.realpath(path.resolve(directory, pkg.bin.sc));
      if (declared !== bin || !bin.startsWith(directory + path.sep)) throw new Error("sc_bin_identity_mismatch");
      return { name: pkg.name, version: pkg.version, root: directory, bin, mcpEntrypoint: path.join(directory, "scripts", "sc-mcp.js") };
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error("sc_package_not_found");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  inspectScInstallation(process.argv[2] || "").then(result => {
    process.stdout.write(process.argv.includes("--json") ? JSON.stringify(result) + "\n" : result.bin + "\n");
  }).catch(() => { process.stderr.write("SI-Coder package identity could not be verified.\n"); process.exitCode = 1; });
}
