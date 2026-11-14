import type { OsApi } from "./types";
import { GiB, delay, loadDemoTree, saveDemoTree } from "./mock-data";
import { makeMockFs } from "./mock-fs";

/**
 * Demo slice row. Every field is labelled with its evidence class so the panel can
 * render provenance in mock mode instead of showing numbers with no origin.
 */
function mockSliceRow(
  slice: string,
  budget: number,
  actual: number,
  evidence: "measured" | "estimated" | "over",
): import("@/lib/contracts/os-api").SliceResourceRow {
  return {
    slice,
    accounted: true,
    rationale: "Mock fixture; the live report reads the real registry.",
    windowMs: 60_000,
    calls: actual,
    fields: [
      {
        field: "externalCallsPerMinute",
        budget,
        actual,
        evidence: evidence === "over" ? "estimated" : evidence,
        status: actual > budget ? "over" : "within",
        provenance: { kind: "policy", file: "lib/os-api/mock-adapter.ts", line: 0, note: "demo value" },
      },
    ],
  };
}

// In-browser simulation of the VPS daemon. Default adapter — the whole OS is
// demoable with zero backend. Mirrors os-rr's MockAdapter contract.
// Split: mock-data.ts owns the seed/fixtures + persistence, mock-fs.ts owns
// the fs port (CLAUDE.md max-200-LOC). This file is the assembly point.
export function MockAdapter(): OsApi {
  const tree = loadDemoTree();  const persist = () => saveDemoTree(tree);
  const services = [
    { unit: "mso.service", scope: "user" as const, load: "loaded", active: "active", sub: "running", description: "Manef Shell OS", controllable: true },
    { unit: "demo-worker.service", scope: "user" as const, load: "loaded", active: "failed", sub: "failed", description: "Demo background worker", controllable: true },
    { unit: "ssh.service", scope: "system" as const, load: "loaded", active: "active", sub: "running", description: "OpenBSD Secure Shell server", controllable: false },
  ];

  return {
    mode: "mock",
    access: { role: "demo", canRead: true, canOperate: true, canOwn: true },
    auth: {
      token: (u) => delay({ token: "mock." + btoa(u || "root"), expires_at: Date.now() + 36e5 }),
      me: () => delay({ user: { name: "root", id: "u_local" } }),
    },
    fs: makeMockFs(tree, persist),
    exec: {
      run: (cmd) =>
        delay({
          stdout: [
            `$ ${cmd}`,
            "demo-server: mock shell only — no command ran on a real host.",
            "warning: background worker restarted 2 minutes ago",
          ].join("\n"),
          stderr: "",
          code: 0,
        }),
    },
    sys: {
      stats: () =>
        delay(
          {
            cpu: { pct: 32, cores: 2 },
            mem: { used: 1.4 * GiB, total: 4 * GiB },
            disk: { used: 41 * GiB, total: 100 * GiB },
            net: { rx: 12, tx: 3 },
            uptime: 2 * 864e5 + 4 * 3600e3,
          },
          60,
        ),
      statsStream: (onEvent) => {
        const iv = setInterval(
          () => onEvent({ cpu: { pct: 32, cores: 2 } }),
          900,
        );
        return () => clearInterval(iv);
      },
      processes: () =>
        delay([
          { pid: 142, name: "demo-server", status: "running", cpu: 12, mem: 540 },
          { pid: 201, name: "background-worker", status: "restarted 2m ago", cpu: 7, mem: 142 },
          { pid: 318, name: "preview-proxy", status: "running", cpu: 3, mem: 88 },
        ]),
      services: () => delay({
        services: services.map((service) => ({ ...service })),
        diagnostics: [],
        truncated: false,
        controlAllowlistConfigured: true,
        generatedAt: new Date().toISOString(),
      }),
      serviceLogs: (scope, unit) => delay({
        unit, scope, available: true, entries: [
          `[mock] ${unit}: started successfully`,
          `[mock] ${unit}: health check passed`,
        ],
      }),
      servicePower: (scope, unit, action) => {
        const service = services.find((entry) => entry.scope === scope && entry.unit === unit);
        if (!service || !service.controllable) return Promise.reject(new Error("service action is not allowlisted"));
        service.active = action === "stop" ? "inactive" : "active";
        service.sub = action === "stop" ? "dead" : "running";
        return delay({ ...service }, 250);
      },
      packageUpdates: () => delay({
        manager: "apt" as const, available: true, truncated: false, checkedAt: new Date().toISOString(), source: "local-cache" as const,
        updates: [
          { name: "openssl", current: "3.0.2-0ubuntu1", candidate: "3.0.2-0ubuntu1.18", architecture: "amd64" },
          { name: "curl", current: "8.5.0-2", candidate: "8.5.0-2ubuntu10", architecture: "amd64" },
        ],
      }),
      // Demo data only. The live route measures real capability calls; this fixture
      // exists so the panel renders in mock mode without pretending to be measured.
      sliceResources: () => delay({
        generatedAt: new Date().toISOString(),
        bufferCapacity: 2048,
        droppedSamples: 0,
        slices: [
          mockSliceRow("system-monitor", 30, 60, "measured"),
          mockSliceRow("assistant", 120, 34, "estimated"),
          mockSliceRow("workflows", 30, 41, "over"),
        ],
        unaccountedSlices: [],
        unaccounted: { calls: 0, wallMs: 0, cpuMs: 0 },
        worst: [mockSliceRow("workflows", 30, 41, "over")],
        scope: { kind: "installation", detail: "Demo data. The live report is installation-wide because the capability ledger is process-global." },
        enforcement: { enabled: false, setting: "OS_SLICE_RESOURCE_ENFORCEMENT", applies_to: "concurrent-tasks only", detail: "Demo mode reports only." },
      }),
    },
    apps: {
      list: () =>
        delay([
          { id: "hermes", name: "Hermes", installed: true, running: true },
          { id: "openclaw", name: "OpenClaw", installed: true, running: false },
        ]),
      logs: (id) =>
        delay({ available: true, entries: [`[mock] ${id}: nothing to report — this is mock mode`] }),
      power: (id, action) =>
        delay({ id, name: id, installed: true, running: action !== "stop" }, 400),
    },
    browser: {
      status: () => delay({ installed: true, running: false, autostart: false }),
      power: (on) => delay({ installed: true, running: on, autostart: false }, 400),
    },
    projects: {
      candidateSearch: (project, query) => delay({
        project: { id: `mock/${project || "demo"}`, name: project || "demo", path: `/mock/projects/${project || "demo"}` },
        revision: "mock",
        rebuilt: false,
        reusedSeed: false,
        indexedEntries: 1,
        candidates: query ? [{ path: "src/demo.ts", kind: "path" as const, size: 128, score: 1 }] : [],
        matches: query ? [{ path: "src/demo.ts", line: 1, preview: `mock candidate for ${query}` }] : [],
        truncated: false,
        truncationReasons: [],
      }),
    },
  };
}
