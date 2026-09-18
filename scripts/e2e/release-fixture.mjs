import { seedSessionMonitor } from "./session-fixture.mjs";
import { mkdir, mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";

export async function releaseFixture({ live = false, surfaceApps = [] } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "mso-release-e2e-"));
  let providerStatus = 200;
  const provider = createServer((req, res) => {
    res.writeHead(req.url === "/api/check_admin_key" ? providerStatus : 404, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));
  const providerUrl = `http://127.0.0.1:${provider.address().port}`;
  const device = randomBytes(16).toString("hex"), password = randomBytes(24).toString("hex");
  const deviceFile = path.join(dir, "devices.json");
  const setRole = async role => {
    let current = {};
    try { current = JSON.parse(await readFile(deviceFile, "utf8")); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
    await writeFile(deviceFile, JSON.stringify({
      ...current,
      approved: { [device]: { label: "Release fixture", role, approvedAt: current.approved?.[device]?.approvedAt ?? Date.now() } },
      pending: current.pending ?? {},
    }), { mode: 0o600 });
  };
  await setRole("owner");
  if (live) await writeFile(path.join(dir, "prefs.json"), JSON.stringify({ tweaks: { server: { mode: "live", activeTargetId: "vps", url: "" } } }), { mode: 0o600 });
  await writeFile(path.join(dir, "fixture.txt"), "MSO release fixture");
  // One real project makes Workflow Directory → Projects verifiable without borrowing the host owner's projects.
  const fixtureProject = path.join(dir, "projects", "fixture-project");
  await mkdir(fixtureProject, { recursive: true });
  await writeFile(path.join(fixtureProject, "package.json"), JSON.stringify({ name: "fixture-project", version: "1.0.0", private: true }), { mode: 0o600 });
  await writeFile(path.join(dir, "infra.json"), JSON.stringify({
    version: 2, instanceId: randomUUID(), defaultUser: "fixture", bindings: [],
    users: { fixture: { id: "fixture", uid: randomUUID(), label: "Release fixture", defaults: { convex: "local" },
      connections: { convex: { local: { id: "local", uid: randomUUID(), label: "Local provider", provider: "convex",
        source: "direct", authMethod: "direct", scope: "account", revision: 1,
        values: { apiUrl: providerUrl, adminKey: "synthetic-fixture-key" },
        createdAt: Date.now(), updatedAt: Date.now(), verifiedAt: Date.now() } } } } },
  }), { mode: 0o600 });
  // Never read deployment .env.local or borrow its credential/device stores.
  const surfaceRegistry = path.join(dir, "surface-apps.json");
  await writeFile(surfaceRegistry, JSON.stringify(surfaceApps), { mode: 0o600 });
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(OS_|MSO_|NEXT_PUBLIC_)/.test(key)));
  const example = await readFile(path.join(process.cwd(), ".env.example"), "utf8");
  for (const [, key] of example.matchAll(/\b((?:OS|MSO)_[A-Z_]*(?:STORE|PATH|DIR|LOG))=/g)) env[key] = path.join(dir, key.toLowerCase());
  Object.assign(env, {
    MSO_SURFACE_APPS_FILE: surfaceRegistry,
    OS_DEVICE_STORE: deviceFile, OS_INFRA_STORE: path.join(dir, "infra.json"),
    OS_CONFIG_STORE: path.join(dir, "config.json"), OS_PREFS_PATH: path.join(dir, "prefs.json"),
    OS_AUDIT_LOG: path.join(dir, "audit.jsonl"), OS_LOGIN_PASSWORD: password,
    OS_SESSION_SECRET: randomBytes(32).toString("hex"), OS_FS_READ_ROOTS: dir, OS_FS_WRITE_ROOTS: dir,
    MSO_SKILL_INSTALL_ROOT: path.join(dir, "skills"), OS_MCP_ENABLED: "1", NEXT_PUBLIC_OS_DEMO: "0", NEXT_TELEMETRY_DISABLED: "1",
  });
  const mcpToken = randomBytes(32).toString("hex");
  const seedMcp = async (scope = "read") => {
    await writeFile(env.OS_MCP_STORE, JSON.stringify({ clients: {}, codes: {}, refreshTokens: {}, tokens: {
      [createHash("sha256").update(mcpToken).digest("hex")]: { label: "Fixture client", clientId: "fixture-client", scope, createdAt: Date.now(), expiresAt: Date.now() + 3600_000 },
    } }), { mode: 0o600 });
  };
  await seedMcp();
  const reservation = createServer();
  await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const base = `http://localhost:${port}`;
  env.OS_PUBLIC_ORIGIN = base;
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { env, stdio: ["ignore", "pipe", "pipe"] });
  let logs = "";
  const capture = chunk => { logs = (logs + chunk.toString()).slice(-8000); };
  server.stdout.on("data", capture); server.stderr.on("data", capture);
  const close = async () => {
    server.kill("SIGTERM");
    await Promise.race([new Promise(resolve => server.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
    if (server.exitCode === null) server.kill("SIGKILL");
    provider.closeAllConnections();
    await new Promise(resolve => provider.close(resolve));
    await rm(dir, { recursive: true, force: true });
  };
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (server.exitCode !== null) throw new Error("Fixture server exited: " + logs);
      try { if ((await fetch(base + "/api/health")).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error("Fixture server did not become ready: " + logs);
    return { dir, base, device, password, setRole, seedMcp, mcpToken, seedSessions: () => seedSessionMonitor(env), revokeProvider: () => { providerStatus = 401; }, close };
  } catch (error) { await close(); throw error; }
}
