import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RemoteProbeCheck, RemoteProbeRequest, RemoteProbeResult } from "@/lib/contracts/remote-connect";
import { externalSurfaceSharesSession } from "@/lib/surfaces/cookie-policy";
import { redact } from "./redact";
import { commandExists, runProgram } from "./runner";

const SAFE_USER = /^[a-zA-Z0-9._-]{1,64}$/;
const SAFE_HOST = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,252}$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function isPrivateLiteralIp(hostname: string): boolean {
  const bare = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (bare === "localhost" || bare === "::1" || bare.startsWith("fe80:") || bare.startsWith("fc") || bare.startsWith("fd")) return true;
  const parts = bare.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function validPort(value: unknown, min = 1, max = 65535): number | null {
  const num = Number(value);
  return Number.isInteger(num) && num >= min && num <= max ? num : null;
}

function resolveContainedPath(raw: string, baseDir: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes("\0") || /[\r\n]/.test(trimmed)) return null;
  const expanded = trimmed === "~" ? os.homedir() : trimmed.startsWith("~/") ? path.join(os.homedir(), trimmed.slice(2)) : path.resolve(baseDir, trimmed);
  const normalizedBase = path.resolve(baseDir);
  const normalizedTarget = path.resolve(expanded);
  if (normalizedTarget !== normalizedBase && !normalizedTarget.startsWith(`${normalizedBase}${path.sep}`)) return null;
  return normalizedTarget;
}

function framingBlocked(headers: Headers): string | null {
  const xfo = headers.get("x-frame-options")?.toLowerCase().trim() ?? "";
  if (xfo.includes("deny") || xfo.includes("sameorigin")) return `X-Frame-Options: ${xfo}`;
  const csp = headers.get("content-security-policy") ?? "";
  const match = /frame-ancestors\s+([^;]+)/i.exec(csp);
  if (match && (match[1].includes("'none'") || match[1].includes("'self'"))) return `CSP frame-ancestors ${match[1].trim()}`;
  return null;
}

async function probeHttpsUrl(rawUrl: string, cockpitOrigins: string[]): Promise<RemoteProbeResult> {
  const checks: RemoteProbeCheck[] = [];
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { ok: false, mode: "https-url", summary: "Enter a valid HTTPS URL such as https://n8n.yourdomain.com.", checks: [{ label: "Address format", status: "error", detail: "URL could not be parsed." }] };
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
    return { ok: false, mode: "https-url", summary: "Use a plain HTTPS URL without passwords or query strings.", checks: [{ label: "HTTPS policy", status: "error", detail: "Only plain https:// URLs are allowed for remote embeds." }] };
  }
  if (isPrivateLiteralIp(parsed.hostname)) {
    return { ok: false, mode: "https-url", summary: "Private/loopback IP addresses belong in Local or SSH mode, not public HTTPS mode.", checks: [{ label: "Origin boundary", status: "error", detail: "Private IP literals are blocked on remote HTTPS probes." }] };
  }
  if (cockpitOrigins.includes(parsed.origin) || externalSurfaceSharesSession(parsed.origin, cockpitOrigins)) {
    return { ok: false, mode: "https-url", summary: "This address shares MSO login cookies. Use a separate subdomain or host.", checks: [{ label: "Cookie isolation", status: "error", detail: "Origin overlaps MSO cockpit session cookie scope." }] };
  }
  checks.push({ label: "Address & cookie isolation", status: "ok", detail: `${parsed.origin} is isolated from MSO cookies.` });
  try {
    const response = await fetch(parsed.href, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(4_000) });
    const statusOk = response.status >= 200 && response.status < 405;
    checks.push({ label: "Server reachability", status: statusOk ? "ok" : "warn", detail: `Server responded with HTTP ${response.status}.` });
    const blocked = framingBlocked(response.headers);
    if (blocked) {
      checks.push({ label: "Iframe embedding", status: "warn", detail: `Embedding is restricted (${blocked}). Opening in a new tab is recommended.` });
      return { ok: statusOk, mode: "https-url", summary: "Server is reachable, but blocks iframe framing. Switch to Open in new tab.", checks, recommendation: { embedMode: "remote", suggestedUrl: parsed.href } };
    }
    checks.push({ label: "Iframe embedding", status: "ok", detail: "No frame-blocking header detected; embedding inside MSO should work." });
    return { ok: statusOk, mode: "https-url", summary: "Connection verified. Ready to save and open inside MSO.", checks, recommendation: { embedMode: "iframe", suggestedUrl: parsed.href } };
  } catch {
    checks.push({ label: "Server reachability", status: "error", detail: "Timed out or could not connect within 4 seconds. Check DNS, tunnel, or firewall." });
    return { ok: false, mode: "https-url", summary: "Could not reach that HTTPS server yet.", checks, recommendation: { embedMode: "iframe", suggestedUrl: parsed.href } };
  }
}

async function probeLocalExisting(endpoint: string, dataDir?: string): Promise<RemoteProbeResult> {
  const checks: RemoteProbeCheck[] = [];
  let parsed: URL;
  try {
    parsed = new URL(endpoint.trim());
  } catch {
    return { ok: false, mode: "local-existing", summary: "Enter a local address like http://127.0.0.1:5678.", checks: [{ label: "Local address", status: "error", detail: "Address could not be parsed." }] };
  }
  if (parsed.protocol !== "http:" || !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase()) || !parsed.port || parsed.username || parsed.password) {
    return { ok: false, mode: "local-existing", summary: "Local address must use http://127.0.0.1:<port> or http://localhost:<port>.", checks: [{ label: "Loopback guard", status: "error", detail: "Only loopback HTTP ports are probed in local mode." }] };
  }
  let reachable = false;
  try {
    const response = await fetch(new URL("/healthz", parsed.origin).href, { method: "GET", redirect: "error", signal: AbortSignal.timeout(2_000) });
    reachable = response.status >= 200 && response.status < 500;
    checks.push({ label: "Local service", status: reachable ? "ok" : "warn", detail: `Answered HTTP ${response.status} on ${parsed.origin}.` });
  } catch {
    checks.push({ label: "Local service", status: "warn", detail: `No server answered at ${parsed.origin}. Make sure the app is started.` });
  }
  if (dataDir?.trim()) {
    const resolved = resolveContainedPath(dataDir, os.homedir());
    if (!resolved) {
      checks.push({ label: "Data directory", status: "error", detail: "Data directory must stay inside your home folder (for example ~/.n8n)." });
    } else {
      try {
        const real = await fs.realpath(resolved);
        const homeReal = await fs.realpath(os.homedir());
        if (real !== homeReal && !real.startsWith(`${homeReal}${path.sep}`)) {
          checks.push({ label: "Data directory", status: "error", detail: "Symlink points outside your home directory." });
        } else {
          const stat = await fs.stat(real);
          checks.push({ label: "Data directory", status: stat.isDirectory() ? "ok" : "error", detail: stat.isDirectory() ? `Found folder ${dataDir.trim()}.` : "Path exists but is not a directory." });
        }
      } catch {
        checks.push({ label: "Data directory", status: "warn", detail: `Folder ${dataDir.trim()} does not exist yet (it will be created on first start).` });
      }
    }
  }
  const hasError = checks.some((c) => c.status === "error");
  return {
    ok: !hasError && reachable,
    mode: "local-existing",
    summary: reachable ? `Local service is alive at ${parsed.origin}.` : `No running service detected at ${parsed.origin} yet.`,
    checks,
    recommendation: { embedMode: "remote", suggestedUrl: parsed.origin },
  };
}

export async function probeSshConnection(input: Extract<RemoteProbeRequest, { mode: "ssh-tunnel" }>): Promise<RemoteProbeResult> {
  const checks: RemoteProbeCheck[] = [];
  const user = input.sshUser.trim();
  const host = input.sshHost.trim();
  const sshPort = validPort(input.sshPort ?? 22, 1, 65535);
  const remotePort = validPort(input.remotePort, 1, 65535);
  const localPort = validPort(input.localPort ?? 15678, 1024, 65535);
  if (!SAFE_USER.test(user) || !SAFE_HOST.test(host) || !sshPort || !remotePort || !localPort) {
    return { ok: false, mode: "ssh-tunnel", summary: "Check SSH user, host, and port numbers (for example user: ubuntu, host: 192.168.1.50, remote port: 5678).", checks: [{ label: "SSH parameters", status: "error", detail: "Invalid user, host, or port number." }] };
  }
  const sshOk = await commandExists("ssh");
  checks.push({ label: "Local SSH client", status: sshOk ? "ok" : "error", detail: sshOk ? "OpenSSH client is available on this host." : "ssh binary was not found on this host." });

  let keyPath: string | null = null;
  if (input.identityFile?.trim()) {
    const sshDir = path.join(os.homedir(), ".ssh");
    const candidate = resolveContainedPath(input.identityFile, sshDir);
    if (!candidate) {
      checks.push({ label: "SSH key file", status: "error", detail: "Key file must be inside ~/.ssh (for example ~/.ssh/id_ed25519)." });
    } else {
      try {
        const stat = await fs.lstat(candidate);
        if (!stat.isFile() || stat.isSymbolicLink()) {
          checks.push({ label: "SSH key file", status: "error", detail: "Key path must be a regular file inside ~/.ssh." });
        } else if ((stat.mode & 0o077) !== 0) {
          checks.push({ label: "SSH key permissions", status: "warn", detail: `Key is too open. Run: chmod 600 ${input.identityFile.trim()}` });
          keyPath = candidate;
        } else {
          checks.push({ label: "SSH key file", status: "ok", detail: `Verified private key file at ${input.identityFile.trim()} (mode 600).` });
          keyPath = candidate;
        }
      } catch {
        checks.push({ label: "SSH key file", status: "error", detail: `Key file not found at ${input.identityFile.trim()}. Generate one with ssh-keygen -t ed25519.` });
      }
    }
  } else {
    checks.push({ label: "SSH key file", status: "ok", detail: "Will use your default ~/.ssh key or ssh-agent." });
  }

  const keyFlag = keyPath ? ` -i ${input.identityFile!.trim()}` : "";
  const tunnelCommand = `ssh -N -L 127.0.0.1:${localPort}:127.0.0.1:${remotePort} -p ${sshPort}${keyFlag} ${user}@${host}`;
  const hasError = checks.some((c) => c.status === "error");
  if (!hasError && input.testSsh) {
    const argv = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "-o", "StrictHostKeyChecking=accept-new", "-p", String(sshPort), ...(keyPath ? ["-i", keyPath] : []), `${user}@${host}`, "true"];
    const result = await runProgram("ssh", argv, 7_000);
    if (result.code === 0) {
      checks.push({ label: "SSH login test", status: "ok", detail: `Connected to ${user}@${host} over port ${sshPort}.` });
    } else {
      const reason = redact(result.stderr.split(/\r?\n/).find(Boolean) ?? "SSH login failed");
      checks.push({ label: "SSH login test", status: "error", detail: `${reason}. Verify your key is added to ~/.ssh/authorized_keys on the remote server.` });
    }
  }
  const ok = !checks.some((c) => c.status === "error");
  return {
    ok,
    mode: "ssh-tunnel",
    summary: ok ? "SSH settings look ready. Save and start the secure loopback tunnel below." : "Fix the highlighted SSH items before starting the tunnel.",
    checks,
    recommendation: { embedMode: "remote", suggestedUrl: `http://127.0.0.1:${localPort}`, tunnelCommand },
  };
}

export async function runRemoteProbe(input: RemoteProbeRequest, requestOrigin: string): Promise<RemoteProbeResult> {
  const origins = [requestOrigin, process.env.OS_PUBLIC_ORIGIN, process.env.OS_MCP_UI_ORIGIN].flatMap((v) => {
    try { return v ? [new URL(v).origin] : []; } catch { return []; }
  });
  if (input.mode === "https-url") return probeHttpsUrl(input.url, origins);
  if (input.mode === "local-existing") return probeLocalExisting(input.endpoint, input.dataDir);
  return probeSshConnection(input);
}
