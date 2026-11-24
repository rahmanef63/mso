import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

export const PUBLIC_ASSET_ENTRIES = [
  "wallpapers",
  "app-icons",
  "brand",
  "demo-media",
  "icon.svg",
  "icon-maskable.svg",
];

const RESERVED_PREFIXES = ["/api", "/_next", "/mcp", "/oauth", "/.well-known", "/a2a"];

export const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".pdf": "application/pdf",
  ".webm": "video/webm",
  ".wav": "audio/wav",
  ".txt": "text/plain; charset=utf-8",
};

function isReservedPath(pathname) {
  const lower = pathname.toLowerCase();
  return RESERVED_PREFIXES.some((prefix) => lower === prefix || lower.startsWith(`${prefix}/`));
}

function resolveSafeFile(baseDir, rawPathname) {
  const pathname = rawPathname.split("?")[0] ?? "/";
  if (!pathname.startsWith("/") || pathname.includes("\0") || pathname.includes("\\")) return null;
  const decoded = decodeURIComponent(pathname);
  const rel = path.posix.normalize(decoded).replace(/^\/+/, "");
  if (!rel || rel.includes("..")) return null;
  const root = path.resolve(baseDir);
  const candidate = path.resolve(root, rel);
  if (!candidate.startsWith(root + path.sep)) return null;
  return candidate;
}

function collectRelativeFiles(dir, prefix = "", out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectRelativeFiles(full, rel, out);
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

export function resolveBuildSha(repoRoot) {
  const envSha = process.env.MSO_BUILD_SHA || process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
  if (envSha && /^[a-f0-9]{7,40}$/i.test(envSha.trim())) return envSha.trim().slice(0, 12);
  try {
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "dev";
  }
}

function isFsError(err, code) {
  return Boolean(err && typeof err === "object" && "code" in err && err.code === code);
}

export function syncPublicAssets(publicDir, buildDir, meta = {}) {
  mkdirSync(buildDir, { recursive: true });
  const copied = [];
  for (const entry of PUBLIC_ASSET_ENTRIES) {
    const src = path.join(publicDir, entry);
    const dst = path.join(buildDir, entry);
    try {
      cpSync(src, dst, { recursive: true, force: true });
    } catch (err) {
      if (isFsError(err, "ENOENT")) continue;
      throw err;
    }
    try {
      const entries = readdirSync(dst, { withFileTypes: true });
      for (const child of entries) {
        const rel = `${entry}/${child.name}`;
        const full = path.join(dst, child.name);
        if (child.isDirectory()) {
          for (const nested of collectRelativeFiles(full, rel)) copied.push(`/${nested}`);
        } else if (child.isFile()) {
          copied.push(`/${rel}`);
        }
      }
    } catch (err) {
      if (isFsError(err, "ENOTDIR")) {
        copied.push(`/${entry}`);
      } else {
        throw err;
      }
    }
  }
  copied.sort();
  const buildMeta = {
    sha: meta.sha ?? "dev",
    mode: meta.mode ?? "production",
    builtAt: new Date().toISOString(),
    assets: copied,
  };
  writeFileSync(path.join(buildDir, "build-meta.json"), JSON.stringify(buildMeta, null, 2) + "\n", "utf8");
  return buildMeta;
}

export function trySendFile(filePath, res, method = "GET") {
  if (!filePath) return false;
  let body;
  try {
    body = readFileSync(filePath);
  } catch {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.statusCode = 200;
  res.setHeader("Content-Type", MIME_TYPES[ext] ?? "application/octet-stream");
  res.setHeader("Content-Length", String(body.byteLength));
  res.end(method === "HEAD" ? undefined : body);
  return true;
}

export function msoPublicAssetsPlugin({ publicDir, buildDir }) {
  return {
    name: "mso-public-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        const pathname = (req.url ?? "/").split("?")[0] ?? "/";
        if (isReservedPath(pathname)) return next();
        let filePath = null;
        try { filePath = resolveSafeFile(publicDir, pathname); } catch { return next(); }
        if (trySendFile(filePath, res, req.method)) return;
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        const pathname = (req.url ?? "/").split("?")[0] ?? "/";
        if (isReservedPath(pathname)) return next();

        let buildFile = null;
        try { buildFile = resolveSafeFile(buildDir, pathname); } catch { return next(); }
        if (trySendFile(buildFile, res, req.method)) return;

        // Missing extensioned assets (e.g. /wallpapers/missing.webp or /_app/immutable/x.js)
        // must fail with 404, never fall back to index.html with wrong MIME.
        const lastSegment = pathname.split("/").filter(Boolean).pop() ?? "";
        if (lastSegment.includes(".")) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end(req.method === "HEAD" ? undefined : "Not Found");
          return;
        }

        const indexHtml = path.join(buildDir, "index.html");
        if (trySendFile(indexHtml, res, req.method)) return;
        next();
      });
    },
  };
}
