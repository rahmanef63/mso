#!/usr/bin/env bun
import path from "node:path";
import { withIntegrationSelection } from "../lib/infra/connection-service";
import { inspectManagedDomainRoute } from "../lib/infra/managed-domain";
import { cleanDomainOrigin, managedDomainHostname, validateDomainConfig } from "../lib/managed-apps/domain-config";
import { discoverManagedDomainTarget } from "../lib/managed-apps/domain-discovery";
import { ensureManagedAppDomain, inspectManagedAppDomain } from "../lib/managed-apps/domain-provision";
import { managedDomainStorePath, readManagedDomains, restoreManagedDomains, saveManagedDomainConfig } from "../lib/managed-apps/domain-store";
import { MANAGED_APP_IDS, type ManagedAppId } from "../lib/managed-apps/types";
import { redactText } from "../lib/security/redact-text";
import { managedDomainEnvironment } from "./domain-env";

const HELP = `mso domain: persistent managed-application DNS and tunnel routes

  mso domain status
  mso domain setup --user <integration-user> --connection <cloudflare-connection>
      [--origin https://mso.example.com] [--template '{id}.mso.example.com']
      [--zone <zone-name-or-id>] [--tunnel <UUID>] [--local http://127.0.0.1:4005]
      [--manual] [--apply]
  mso domain ensure <hermes|openclaw|9router> [--apply]
  mso domain doctor <hermes|openclaw|9router>
  mso domain repair-env [--apply]
  mso domain restore [--apply]

Setup discovers the existing zone/account/tunnel from the MSO hostname, then stores
only named credential references. Enter Cloudflare credentials privately in MSO
Integrations. Required API access: Zone Read, DNS Edit, and Cloudflare Tunnel Edit.
Setup/ensure/repair-env/restore preview by default; --apply performs that operation.
After first setup, run mso deploy (or mso update --rebuild for a gateway-owned
runtime) to activate the app-host template. App installs, starts and restarts
then provision automatically unless setup uses --manual.
Existing remotely managed tunnels and MSO-owned named local tunnels are supported.
External local tunnels are left untouched. DNS and HTTPS readiness are separate.
App hosts retain MSO authorization through app-bound, host-only cookies.
Nested hosts need an edge certificate covering their exact hostname; MSO never
purchases a certificate or treats a DNS record as proof that HTTPS works.`;

const [action = "status", ...argv] = process.argv.slice(2);
const options: Record<string, string | boolean> = {};
let appId: string | undefined;
const valueFlags = new Set(["user", "connection", "origin", "template", "zone", "tunnel", "local"]);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith("--")) { if (appId) fail("only one application ID is allowed"); appId = arg; continue; }
  const name = arg.slice(2);
  if (Object.hasOwn(options, name)) fail(`duplicate option --${name}`);
  if (["apply", "manual", "json"].includes(name)) options[name] = true;
  else if (valueFlags.has(name) && argv[i + 1] && !argv[i + 1].startsWith("--")) options[name] = argv[++i];
  else fail(`unknown or incomplete option --${name}`);
}
function fail(message: string): never { process.stderr.write(`mso domain: ${redactText(message, 1024)}\n`); process.exit(1); }
function emit(value: unknown) { process.stdout.write(JSON.stringify(value, null, 2) + "\n"); }
function str(key: string) { return typeof options[key] === "string" ? options[key] as string : undefined; }
function selectedApp(): ManagedAppId {
  if (!(MANAGED_APP_IDS as readonly string[]).includes(appId ?? "")) fail(`choose ${MANAGED_APP_IDS.join(", ")}`);
  return appId as ManagedAppId;
}
function envFile() { return path.resolve(process.env.MSO_DOMAIN_ENV ?? path.join(process.cwd(), ".env.local")); }

async function main() {
  if (["help", "--help", "-h"].includes(action)) { process.stdout.write(HELP + "\n"); return; }
  if (!["status", "setup", "ensure", "doctor", "repair-env", "restore"].includes(action)) fail("unknown command; run mso domain help");
  if (action !== "setup" && Object.keys(options).some(key => valueFlags.has(key) || key === "manual")) fail("setup options belong only to mso domain setup");
  if (!["ensure", "doctor"].includes(action) && appId) fail("this command takes no application ID");
  if (["status", "doctor"].includes(action) && options.apply) fail(`${action} is read-only; omit --apply`);
  if (action === "status") {
    const state = await readManagedDomains();
    emit({ store: managedDomainStorePath(), ...state, desired: state.config ? Object.fromEntries(MANAGED_APP_IDS.map(id => [id, `https://${managedDomainHostname(state.config!, id)}`])) : {} });
    return;
  }
  if (action === "setup") {
    if (appId) fail("setup takes named options, not an application ID");
    const publicOrigin = cleanDomainOrigin(str("origin") ?? process.env.OS_PUBLIC_ORIGIN ?? "");
    const user = str("user"), connection = str("connection");
    if (!user || !connection) fail("--user and --connection select the existing Cloudflare integration");
    const target = await withIntegrationSelection({ user, connection }, () => discoverManagedDomainTarget(publicOrigin, str("zone"), str("tunnel")));
    const config = validateDomainConfig({ ...target, publicOrigin, user, connection,
      hostTemplate: str("template") ?? (process.env.NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE?.trim() || `{id}.${new URL(publicOrigin).hostname}`),
      localOrigin: cleanDomainOrigin(str("local") ?? process.env.MSO_DOMAIN_LOCAL_ORIGIN ?? "http://127.0.0.1:4005", true),
      autoProvision: options.manual !== true,
    });
    const saved = await readManagedDomains();
    let environment = await managedDomainEnvironment(envFile(), config, false);
    await withIntegrationSelection({ user, connection }, () => inspectManagedDomainRoute({ ...target,
      hostname: managedDomainHostname(config, "9router"), hostTemplate: config.hostTemplate, cockpitHostname: new URL(publicOrigin).hostname,
      localOrigin: config.localOrigin, ownerTag: `mso:${saved.ownerId}:9router`,
    }));
    if (options.apply) {
      await saveManagedDomainConfig(config);
      try { environment = await managedDomainEnvironment(envFile(), config, true); }
      catch (error) {
        throw new Error(`Domain configuration was saved, but the environment update failed: ${error instanceof Error ? error.message : "write failed"}. Retry mso domain repair-env --apply`);
      }
    }
    emit({ applied: options.apply === true, config, environment, store: managedDomainStorePath(),
      next: "Run mso deploy (or mso update --rebuild for a gateway-owned runtime) once to activate this template, then mso mapp enable 9router (or mso domain ensure 9router --apply for an already running app).",
      tls: "Every generated hostname requires valid HTTPS; nested names may require an explicitly issued edge certificate.",
    });
    return;
  }
  if (action === "ensure") {
    const id = selectedApp();
    if (!options.apply) { emit({ preview: true, ...(await inspectManagedAppDomain(id)), next: `mso domain ensure ${id} --apply` }); return; }
    const result = await ensureManagedAppDomain(id);
    emit(result ?? { configured: false, next: "mso domain setup --user <user> --connection <connection> --apply" });
    if (!result || result.phase !== "ready") process.exitCode = 2;
    return;
  }
  if (action === "doctor") {
    const result = await inspectManagedAppDomain(selectedApp()); emit(result);
    if (!result.configured || Object.values(result.checks ?? {}).some(value => value !== "ok")) process.exitCode = 2;
    return;
  }
  if (appId) fail("this command takes no application ID");
  if (action === "repair-env") {
    const { config } = await readManagedDomains();
    if (!config) fail("no saved domain setup exists");
    emit(await managedDomainEnvironment(envFile(), config, options.apply === true)); return;
  }
  if (action === "restore") {
    emit(options.apply ? await restoreManagedDomains() : { preview: true, source: `${managedDomainStorePath()}.previous`, next: "mso domain restore --apply; mso domain repair-env --apply" }); return;
  }
  fail("unknown command; run mso domain help");
}
try { await main(); } catch (error) { fail(error instanceof Error ? error.message : "operation failed"); }
