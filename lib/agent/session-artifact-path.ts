import path from "node:path";

const CODE_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "svelte", "py", "sh", "bash", "zsh", "md", "json", "yaml", "yml", "css", "scss", "html", "sql", "toml"]);

export type SessionArtifactCandidate = {
  path: string;
  relativePath: string;
  label: string;
  kind: "file" | "script";
  language: string;
};

export function artifactLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return ({ ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript", svelte: "svelte", py: "python", sh: "bash", bash: "bash", zsh: "zsh", md: "markdown", json: "json", yaml: "yaml", yml: "yaml", css: "css", scss: "scss", html: "html", sql: "sql", toml: "toml" } as Record<string, string>)[ext] || "text";
}

export function resolveSessionArtifactCandidate(detail: string | undefined, cwd: string | undefined): SessionArtifactCandidate | undefined {
  if (!detail || !cwd) return undefined;
  const candidates = detail.match(/(?:\/|\.?\.?\/)?[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*\.[A-Za-z0-9]+/g) || [];
  for (const raw of candidates) {
    const ext = raw.split(".").pop()?.toLowerCase() || "";
    if (!CODE_EXTENSIONS.has(ext) || raw.includes("..")) continue;
    const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(cwd, raw.replace(/^\.\//, ""));
    const rel = path.relative(path.resolve(cwd), resolved);
    if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) continue;
    return {
      path: resolved,
      relativePath: rel.replaceAll(path.sep, "/"),
      label: path.basename(resolved),
      kind: ["sh", "bash", "zsh", "py", "js", "ts"].includes(ext) ? "script" : "file",
      language: artifactLanguage(resolved),
    };
  }
  return undefined;
}
