import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE = "{id}.mso.example.com";
  process.env.OS_PUBLIC_ORIGIN = "https://mso.example.com";
});

import type { ChildProcess } from "node:child_process";
import { rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { getOrcaReadiness } from "../../lib/managed-apps/orca-readiness";
import { createFixtureDirectory, seedOrcaRuntime } from "./orca-rewrite-harness.mjs";

function get(url: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
    }).on("error", reject);
  });
}

describe("orca-rewrite-harness built-server fixture", () => {
  const cleanupDirs: string[] = [];

  afterAll(async () => {
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop()!;
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("denies readiness when receipt serverPid does not own the listener socket", async () => {
    const root = await createFixtureDirectory("mso-orca-test-red-");
    cleanupDirs.push(root);

    const runtime = await seedOrcaRuntime(root, { wrongPid: true });
    try {
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: "test",
        ORCA_HOME: root,
        ORCA_DASHBOARD_URL: runtime.url,
      };
      const readiness = await getOrcaReadiness({ env });
      expect(readiness.available).toBe(false);
      if (!readiness.available) {
        expect(["listener_not_owned_by_process", "process_identity_unavailable"]).toContain(readiness.reason);
      }
    } finally {
      await runtime.close();
    }
  });

  it("denies readiness when receipt claims a different loopback port not listened by child", async () => {
    const root = await createFixtureDirectory("mso-orca-test-port-");
    cleanupDirs.push(root);

    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const wrongPort = (server.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => server.close(() => resolve()));

    const runtime = await seedOrcaRuntime(root, { wrongPort });
    try {
      const env: NodeJS.ProcessEnv = {
        NODE_ENV: "test",
        ORCA_HOME: root,
        ORCA_DASHBOARD_URL: `http://127.0.0.1:${wrongPort}`,
      };
      const readiness = await getOrcaReadiness({ env });
      expect(readiness.available).toBe(false);
      if (!readiness.available) {
        expect(["listener_not_found", "listener_not_owned_by_process"]).toContain(readiness.reason);
      }
    } finally {
      await runtime.close();
    }
  });

  it("cleans up child process when receipt write fails", async () => {
    const root = await createFixtureDirectory("mso-orca-test-fail-");
    cleanupDirs.push(root);

    let pid: number | undefined;
    await expect(
      seedOrcaRuntime(root, {
        onSpawn(child: ChildProcess) {
          pid = child.pid;
        },
        writeReceipt: async () => {
          throw new Error("fixture receipt failure");
        },
      }),
    ).rejects.toThrow("fixture receipt failure");

    expect(pid).toBeDefined();
    expect(pid).toBeGreaterThan(1);
    expect(() => process.kill(pid!, 0)).toThrow();
  });

  it("proves fixture child owns actual upstream listener with same PID and handles requests", async () => {
    const root = await createFixtureDirectory("mso-orca-test-green-");
    cleanupDirs.push(root);

    const runtime = await seedOrcaRuntime(root);
    try {
      expect(runtime.pid).toBeGreaterThan(1);
      expect(runtime.port).toBeGreaterThan(0);
      expect(runtime.url).toBe(`http://127.0.0.1:${runtime.port}`);

      const env: NodeJS.ProcessEnv = {
        NODE_ENV: "test",
        ORCA_HOME: root,
        ORCA_DASHBOARD_URL: runtime.url,
      };
      const readiness = await getOrcaReadiness({ env });
      expect(readiness.available).toBe(true);
      if (readiness.available) {
        expect(readiness.serverPid).toBe(runtime.pid);
        expect(readiness.boundEndpoint).toBe(`ws://127.0.0.1:${runtime.port}`);
      }

      const res200 = await get(`${runtime.url}/web-index.html`);
      expect(res200.status).toBe(200);
      expect(res200.text).toContain("orca-fixture-upstream");

      const res404 = await get(`${runtime.url}/not-found`);
      expect(res404.status).toBe(404);

      // Brief wait for IPC hit event propagation
      for (let i = 0; i < 50 && runtime.hits.length < 2; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(runtime.hits.length).toBe(2);
      expect(runtime.hits[0].url).toBe("/web-index.html");
    } finally {
      await runtime.close();
      // Ensure child process is no longer running
      expect(() => process.kill(runtime.pid!, 0)).toThrow();
    }
  });
});
