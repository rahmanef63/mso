import { constants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { doctorAdditionalProvider } from "./additional-doctor";
import { credentialSnapshot, saveConnectionValues } from "./connection-service";
import { IntegrationError, type ConnectionSelector } from "./identity";

const MAX_CLI_CONFIG_BYTES = 64 * 1024;

export async function readConvexCliAccessToken(
  configPath = path.join(os.homedir(), ".convex", "config.json"),
): Promise<string> {
  const file = path.resolve(configPath),
    dir = path.dirname(file);
  let dst;
  try {
    dst = await fs.lstat(dir);
  } catch {
    throw new IntegrationError("convex_cli_config_not_found", 404);
  }
  if (
    dst.isSymbolicLink() ||
    !dst.isDirectory() ||
    (typeof process.getuid === "function" && dst.uid !== process.getuid())
  )
    throw new IntegrationError("unsafe_convex_cli_config");
  if ((dst.mode & 0o077) !== 0) await fs.chmod(dir, 0o700);
  let handle;
  try {
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (
      !stat.isFile() ||
      stat.nlink !== 1 ||
      stat.size < 2 ||
      stat.size > MAX_CLI_CONFIG_BYTES ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())
    )
      throw new IntegrationError("unsafe_convex_cli_config");
    if ((stat.mode & 0o077) !== 0) await handle.chmod(0o600);
    const parsed = JSON.parse(await handle.readFile("utf8")) as Record<
      string,
      unknown
    >;
    const token = parsed.accessToken;
    if (
      typeof token !== "string" ||
      token.length < 20 ||
      token.length > 8192 ||
      /[\x00-\x20\x7f]/.test(token)
    )
      throw new IntegrationError("convex_cli_access_token_missing", 409);
    return token;
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ELOOP")
      throw new IntegrationError("unsafe_convex_cli_config");
    throw new IntegrationError("invalid_convex_cli_config");
  } finally {
    await handle?.close();
  }
}

export async function importConvexCliPersonalConnection(
  selector: ConnectionSelector,
  options: {
    configPath?: string;
    doctor?: typeof doctorAdditionalProvider;
  } = {},
) {
  const snapshot = await credentialSnapshot("convex-cloud", selector),
    c = snapshot.connection;
  if (c.source !== "direct" || c.authMethod !== "personal")
    throw new IntegrationError("connection_auth_mismatch", 409);
  const token = await readConvexCliAccessToken(options.configPath),
    doctor = options.doctor ?? doctorAdditionalProvider;
  const detail = await doctor("convex-cloud", { personalToken: token });
  if (!detail) throw new IntegrationError("convex_cli_token_not_verified", 409);
  const connection = await saveConnectionValues(
    "convex-cloud",
    selector,
    { personalToken: token },
    { uid: c.uid, revision: c.revision },
    true,
  );
  return {
    ok: true,
    action: "connection.import-convex-cli",
    source: "convex-cli",
    permissions: { directory: "0700", file: "0600" },
    verification: detail,
    connection,
  };
}
