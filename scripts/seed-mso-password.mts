/**
 * Create or update one mso-password connection through the app's own setup path.
 *
 *   npx tsx scripts/seed-mso-password.mts <host> <connectionId>
 *   (password read from stdin, never from argv — argv is visible in `ps`)
 *
 * Why not edit ~/.mso/private/infra-providers.json directly: that store is guarded by
 * a lock, a revision and a schema. Writing it by hand would skip the validation this
 * change added (bare hostname, expiresAt === "0") and could corrupt a file the whole
 * MSO cockpit depends on.
 *
 * `openIntegrationSetup` + `consumeIntegrationSetup` is exactly what the browser form
 * does, so the stored row is byte-for-byte what a UI save would produce.
 */
import { createInterface } from "node:readline";
import { listInfraProviderDefinitions } from "../lib/infra/catalog";
import { credentialSnapshot } from "../lib/infra/connection-service";
import { integrationManage } from "../lib/infra/connection-manage";
import { consumeIntegrationSetup, openIntegrationSetup } from "../lib/infra/setup-capability";

const PROVIDER = "mso-password";
const [host, connectionId] = process.argv.slice(2);
const USER = process.env.MSO_STORE_USER?.trim() || "rahman";

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Read one line from stdin without echoing it into argv or the process list. */
function readSecret(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      let data = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { data += chunk; });
      process.stdin.on("end", () => resolve(data.split("\n")[0]));
      process.stdin.on("error", reject);
      return;
    }
    process.stderr.write(prompt);
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    rl.question("", (answer) => { rl.close(); resolve(answer); });
  });
}

async function ensureConnection(): Promise<void> {
  if (!listInfraProviderDefinitions().some((row) => row.id === PROVIDER)) {
    die(`${PROVIDER} is not in the provider catalog; is this worktree on the new code?`);
  }
  try {
    await credentialSnapshot(PROVIDER, { user: USER, connection: connectionId });
    console.log(`connection ${USER}/${PROVIDER}/${connectionId} exists; updating values`);
    return;
  } catch {
    // Absent is the expected first run, not an error.
  }
  await integrationManage({
    action: "connection.create",
    confirm: true,
    user: USER,
    provider: PROVIDER,
    connection: connectionId,
    label: `MSO ${host}`,
    source: "direct",
    authMethod: "direct",
  });
  console.log(`created connection ${USER}/${PROVIDER}/${connectionId}`);
}

async function main(): Promise<void> {
  if (!host || !connectionId) die("usage: seed-mso-password.mts <host> <connectionId>  (password on stdin)");
  const password = (await readSecret(`Password for ${host}: `)).trim();
  if (!password) die("empty password; nothing saved");

  await ensureConnection();

  const { token } = await openIntegrationSetup(
    PROVIDER,
    `local:${process.env.USER ?? "operator"}`,
    "direct",
    { user: USER, connection: connectionId },
  );

  // `expiresAt: "0"` is the owner's requirement: this record never expires. The schema
  // rejects anything else, so the intent is enforced, not merely intended.
  const result = (await consumeIntegrationSetup(token, { host, password, expiresAt: "0" })) as {
    verified: boolean; configurationOnly: boolean;
  };

  const snapshot = await credentialSnapshot(PROVIDER, { user: USER, connection: connectionId });
  // Never print the password, not even masked here: the store's own summary is the
  // only place a mask belongs.
  console.log(JSON.stringify({
    saved: true,
    provider: PROVIDER,
    user: USER,
    connection: connectionId,
    verified: result.verified,
    configurationOnly: result.configurationOnly,
    host: snapshot.connection.values.host,
    expiresAt: snapshot.connection.values.expiresAt,
    passwordStored: Boolean(snapshot.connection.values.password),
  }, null, 2));
}

main().catch((error) => die(`failed: ${error?.code ?? error?.message ?? error}`));
