import { constants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expandOwnerStorePath } from "./owner-store-path.js";

// A kernel-pinned parent keeps lock/file operations on one directory even if its
// pathname is replaced. Linux /proc/self/fd is the supported VPS/WSL runtime.
// Store filenames remain adjacent and compatible with the independent device CLI.
const STORE_ENV = [
  "OS_DEVICE_STORE", "OS_MCP_STORE", "OS_INFRA_STORE", "OS_MEMORY_STORE", "OS_MCP_ACTIVITY_LOG",
  "OS_A2A_STORE", "OS_A2A_TASK_STORE", "OS_A2A_CREDENTIAL_STORE", "OS_A2A_INBOUND_TOKEN_STORE",
  "OS_A2A_LOCAL_AUTH_STORE", "OS_LOCAL_AGENT_MESSAGE_STORE", "OS_LOCAL_AGENT_PRESENCE_STORE",
  "OS_CONFIG_STORE", "OS_PREFS_PATH", "OS_SKILL_MEMORY_STORE",
] as const;
const DIRECTORY_ENV = ["OS_TOOL_FORGE_DIR", "OS_AGENT_MEMORY_DIR", "OS_AGENT_SESSIONS_DIR", "OS_PROJECT_AGENT_TASKS_DIR"] as const;
const expand = (value: string) => path.resolve(expandOwnerStorePath(value));

export async function pinSecurityStorePath(storePath: string) {
  if (process.platform !== "linux") throw new Error("Pinned security-store operations require Linux or WSL");
  storePath = expandOwnerStorePath(storePath);
  if (typeof storePath !== "string" || storePath.includes("\0") || !path.isAbsolute(storePath)) throw new Error("Security store needs an absolute path");
  const absolute = path.resolve(storePath);
  const name = path.basename(absolute);
  if (!/^[A-Za-z0-9_.-]{1,221}$/.test(name) || name === "." || name === "..") throw new Error("Invalid security-store filename");
  const allowed = [os.homedir(), ...(process.env.OS_FS_WRITE_ROOTS ?? "").split(":").filter(Boolean),
    ...STORE_ENV.flatMap((key) => process.env[key] ? [path.dirname(expand(process.env[key]!))] : []),
    ...DIRECTORY_ENV.flatMap((key) => process.env[key] ? [expand(process.env[key]!)] : []),
    // Test sandboxes are private mkdtemp directories, never the shared temp root itself.
    ...(process.env.VITEST ? [os.tmpdir()] : [])];
  if (!allowed.some((root) => absolute.startsWith(`${expand(root)}${path.sep}`))) throw new Error("Security store is outside configured owner roots");
  const parent = path.dirname(absolute);
  const directory = await openDirectoryChain(parent);
  try {
    const stat = await directory.stat();
    if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o022)) throw new Error("Security-store parent must be owned and not writable by others");
    const pinnedRoot = `/proc/self/fd/${directory.fd}`;
    // Reject all symlinked ancestor spellings as well as a swapped parent inode.
    if (await fs.realpath(pinnedRoot) !== parent) throw new Error("Security-store parent is not canonical");
    return { file: `${pinnedRoot}/${name}`, directory, absolute };
  } catch (error) {
    await directory.close();
    throw error;
  }
}

// Walk from a stable descriptor, opening one basename at a time with O_NOFOLLOW.
// Creating a missing parent must not follow an attacker-controlled intermediate link.
async function openDirectoryChain(parent: string) {
  let directory = await fs.open("/", constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    const parts = parent.split(path.sep).filter(Boolean);
    if (parts.length > 128) throw new Error("Security-store path is too deep");
    for (const part of parts) {
      if (!part || part === "." || part === ".." || /[/\\\0]/.test(part)) throw new Error("Invalid store directory component");
      const child = `/proc/self/fd/${directory.fd}/${path.basename(part)}`;
      let next;
      try { next = await fs.open(child, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await fs.mkdir(child, { mode: 0o700 }).catch((cause: NodeJS.ErrnoException) => { if (cause.code !== "EEXIST") throw cause; });
        next = await fs.open(child, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      }
      await directory.close();
      directory = next;
    }
    return directory;
  } catch (error) { await directory.close(); throw error; }
}
