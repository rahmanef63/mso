import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The CLI's dispatch table and its help are the same comment block, so a verb
// that exists in one and not the other is a real bug. These run WITHOUT a server:
// help and unknown-command are the two paths that must never need auth, because
// they are what you reach for when the service is down.
const CLI = path.join(__dirname, "mso");
const run = (...args: string[]) =>
  execFileSync(CLI, args, { encoding: "utf8", env: { ...process.env, MSO_ENV: "/dev/null" } });

describe("bin/mso", () => {
  it("prints help without logging in", () => {
    const out = run("-h");
    expect(out).toContain("Manef Shell OS");
    expect(out).toContain("Usage: mso");
    for (const verb of ["camoufox", "approve", "service", "api", "exec", "doctor"]) {
      expect(out).toContain(verb);
    }
  });

  it("documents every verb the dispatch table implements", () => {
    const src = require("node:fs").readFileSync(CLI, "utf8") as string;
    const body = src.slice(src.indexOf('cmd="${1:-help}"'));
    // Case arms look like `  ls)` / `  camoufox)` / `  devices|device)`. Aliases
    // are split out too — an alias absent from the help is just as unfindable.
    const verbs = [...body.matchAll(/^ {2}([a-z][a-z|-]*)\)/gm)].flatMap((m) => m[1].split("|"));
    expect(verbs.length).toBeGreaterThan(20);
    expect(verbs).toContain("device");
    const help = run("-h");
    // `help`/`-h`/`--help` are the conventional flags every CLI has; they don't
    // need a line in the very help they print.
    const undocumented = verbs.filter(
      (v) => v !== "help" && !v.startsWith("-") && !help.includes(v),
    );
    expect(undocumented).toEqual([]);
  });

  it("exits non-zero on an unknown command", () => {
    expect(() => run("definitely-not-a-verb")).toThrow();
  });

  it("keeps docs/CLI.md in sync with the help", () => {
    // docs/CLI.md is generated from this same help text. A doc that silently
    // describes an older CLI is worse than no doc, so staleness fails here
    // rather than being noticed by whoever followed it.
    expect(() =>
      execFileSync("node", [path.join(__dirname, "../scripts/gen-cli-docs.mjs"), "--check"], {
        encoding: "utf8",
      }),
    ).not.toThrow();
  });

  // "Covers every need" is only true if it stays true. Every API route must be
  // reachable by a named verb, except the ones a shell genuinely cannot drive.
  it("has a named verb for every API route", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const repo = path.join(__dirname, "..");
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? walk(p) : e.name === "route.ts" ? [p] : [];
      });
    // (method, path) pairs, not paths. A path-only check passed while POST
    // /managed-apps/[id] (start/stop/restart/backup), DELETE
    // .../jobs/[jobId] and GET /api/skills?name= had no verb at all — the file
    // merely mentioned the path somewhere for a DIFFERENT method.
    const files = walk(path.join(repo, "app/api"));
    const routes = files.flatMap((p) => {
      const route = "/" + path.relative(repo, p).replace(/^app\//, "").replace(/\/route\.ts$/, "");
      const src = fs.readFileSync(p, "utf8");
      return [...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map(
        (m) => `${m[1]} ${route}`,
      );
    });
    const cli = fs.readFileSync(CLI, "utf8");

    // Not reachable from a shell, each for its own reason:
    //  • /api/sw is fetched by the browser to install the service worker.
    //  • the managed-app proxy exists to be iframed.
    //  • /api/auth/devices reads the same store `mso device list` reads straight
    //    off disk, which keeps working while the service is down.
    // OAuth is NOT here any more: it is a device-code POST, not a redirect, so
    // `mso oauth <provider> start|poll` covers it.
    const browserOnly = [
      "GET /api/sw",
      "/api/v1/managed-apps/[id]/proxy/[[...path]]",
      "/api/auth/devices",
    ];

    // The CLI writes each call as `jget "/path"` / `jpost "/path"` / `jdel "/path"`,
    // so the helper name carries the method. `reqraw` and a bare `req` are the
    // escape hatches for the calls the json helpers cannot make — binary bodies
    // (fs/raw, fs/zip), a live SSE stream (term/stream) and multipart (fs/upload)
    // — and `curl` covers doctor's own probes. They are listed under the method
    // they actually issue, so this stays a method check, not a free pass.
    const HELPERS: Record<string, string[]> = {
      GET: ["jget", "reqraw", "curl"],
      POST: ["jpost", "req -F", "-X POST"],
      PUT: ["jput"],
      PATCH: ["jpatch"],
      DELETE: ["jdel"],
    };

    const uncovered = routes.filter((mr) => {
      const [method, route] = mr.split(" ");
      if (browserOnly.some((b) => mr === b || route === b)) return false;
      // Dynamic segments are built by interpolation, so match on the literal
      // chunks either side of a [param].
      const parts = route.split("/").filter((s) => s && !s.startsWith("["));
      const stem = `/${parts.join("/")}`;
      const tail = parts[parts.length - 1];
      return !HELPERS[method].some((h) => {
        const i = cli.indexOf(h);
        if (i < 0) return false;
        // Look for the helper and the path on the same line.
        return cli
          .split("\n")
          .some((line) => line.includes(h) && (line.includes(stem) || line.includes(`/${tail}"`) || line.includes(`/${tail}?`) || line.includes(`/${tail}/`)));
      });
    });
    expect(uncovered).toEqual([]);
    expect(routes.length).toBeGreaterThan(50);
  });

  it("refuses `device revoke all` without --yes, and leaves the store intact", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const os = require("node:os") as typeof import("node:os");
    const store = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mso-dev-")), "devices.json");
    const before = JSON.stringify({ approved: { ["a".repeat(32)]: { label: "x" } }, pending: {} });
    fs.writeFileSync(store, before);
    const withStore = (...args: string[]) =>
      execFileSync(CLI, args, {
        encoding: "utf8",
        env: { ...process.env, MSO_ENV: "/dev/null", OS_DEVICE_STORE: store, MSO_SYSTEMCTL_BIN: "/bin/true" },
      });

    // Revoking everything signs every browser out; one keystroke from `revoke <id>`.
    expect(() => withStore("device", "revoke", "all")).toThrow();
    expect(fs.readFileSync(store, "utf8")).toBe(before);

    // "-yes" is one character from "--yes"; a near miss must not silently count
    // as confirmation, and must say which flag was actually seen.
    let stderr = "";
    try {
      withStore("device", "revoke", "all", "-yes");
    } catch (e) {
      stderr = String((e as { stderr?: Buffer }).stderr ?? "");
    }
    expect(stderr).toContain('you passed "-yes"');
    expect(fs.readFileSync(store, "utf8")).toBe(before);

    withStore("device", "revoke", "all", "--yes");
    expect(JSON.parse(fs.readFileSync(store, "utf8")).approved).toEqual({});
  });

  it("fails closed instead of replacing a corrupt device allowlist", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const os = require("node:os") as typeof import("node:os");
    const store = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mso-dev-")), "devices.json");
    const corrupt = "{ this is not valid json";
    fs.writeFileSync(store, corrupt);
    const id = "e".repeat(32);

    expect(() =>
      execFileSync(CLI, ["device", "approve", id, "test"], {
        encoding: "utf8",
        env: { ...process.env, MSO_ENV: "/dev/null", OS_DEVICE_STORE: store, MSO_SYSTEMCTL_BIN: "/bin/true" },
      }),
    ).toThrow();
    expect(fs.readFileSync(store, "utf8")).toBe(corrupt);
  });

  it("prints a paste-ready command under every device, quoted safely", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const os = require("node:os") as typeof import("node:os");
    const store = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mso-dev-")), "devices.json");
    const pendingId = "c".repeat(32);
    const approvedId = "d".repeat(32);
    // A label with a quote AND a space is the case that breaks naive `"${label}"`
    // interpolation — the pasted line would split into several arguments.
    const nasty = 'Chrome "work" laptop';
    fs.writeFileSync(
      store,
      JSON.stringify({
        approved: { [approvedId]: { label: "phone" } },
        pending: { [pendingId]: { label: nasty, ip: "10.0.0.1", attempts: 1 } },
      }),
    );
    const withStore = (...args: string[]) =>
      execFileSync(CLI, args, {
        encoding: "utf8",
        env: { ...process.env, MSO_ENV: "/dev/null", OS_DEVICE_STORE: store, MSO_SYSTEMCTL_BIN: "/bin/true" },
      });

    const list = withStore("device", "list");
    expect(list).toContain(`mso device approve ${pendingId} ${JSON.stringify(nasty)} --role viewer`);
    expect(list).toContain(`mso device revoke ${approvedId}`);
    // The bare id stays on its own line — way (1) still works.
    expect(list).toMatch(new RegExp(`^ {2}${pendingId} `, "m"));

    expect(withStore("device", "pending")).toContain(
      `mso device approve ${pendingId} ${JSON.stringify(nasty)} --role viewer`,
    );
  });

  it("accepts -y as confirmation and reports what is left after a single revoke", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const os = require("node:os") as typeof import("node:os");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mso-dev-"));
    const store = path.join(dir, "devices.json");
    const ids = ["a".repeat(32), "b".repeat(32)];
    const seed = () =>
      fs.writeFileSync(
        store,
        JSON.stringify({ approved: { [ids[0]]: { label: "one" }, [ids[1]]: { label: "two" } }, pending: {} }),
      );
    const withStore = (...args: string[]) =>
      execFileSync(CLI, args, {
        encoding: "utf8",
        env: { ...process.env, MSO_ENV: "/dev/null", OS_DEVICE_STORE: store, MSO_SYSTEMCTL_BIN: "/bin/true" },
      });

    seed();
    withStore("device", "revoke", "all", "-y");
    expect(JSON.parse(fs.readFileSync(store, "utf8")).approved).toEqual({});

    // Revoking your last device locks you out of the UI — that has to be loud.
    seed();
    expect(withStore("revoke", ids[0])).toContain("1 device(s) still approved");
    expect(withStore("revoke", ids[1])).toContain("NO devices approved");
  });
});
