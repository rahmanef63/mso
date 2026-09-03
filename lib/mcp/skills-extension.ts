import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { readBoundedRegularBuffer } from "@/lib/host/bounded-read";

export const MCP_SKILLS_EXTENSION = "io.modelcontextprotocol/skills";
export const MCP_SKILL_SCHEME = "skill:";

// OpenAI currently imports at most five skills. Keep this as a deliberately small
// operator syllabus rather than exposing project/local/untrusted instructions.
export const CHATGPT_PUBLISHED_SKILLS = [
  "mso",
  "mso-repo-work",
  "mso-service-debug",
  "mso-deploy",
  "mso-mcp-feature-engineering",
] as const;

const SERVER_NAMESPACE = "mso";
const MAX_SKILLS = 5;
const MAX_FILES_PER_SKILL = 100;
const MAX_SKILL_MD_BYTES = 256 * 1024;
const MAX_SUPPORTING_FILE_BYTES = 1024 * 1024;
const MAX_SKILL_TOTAL_BYTES = 5 * 1024 * 1024;
const MAX_SCAN_ARCHIVE_BYTES = 8 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".sh", ".py", ".toml", ".ini", ".csv", ".html", ".css", ".xml"]);

type SkillResource = { uri: string; digest: string };
type SkillEntry = { uri: string; frontmatter: Record<string, unknown>; resources: SkillResource[] };
type ReadSkillResource = { uri: string; mimeType: string; text?: string; blob?: string };
type SkillFile = { relative: string; absolute: string; data: Buffer; uri: string; digest: string };
type LoadedSkill = { name: string; entry: SkillEntry; files: SkillFile[] };

function sha256(data: Buffer): string {
  return `sha256:${createHash("sha256").update(data).digest("hex")}`;
}

function skillUri(name: string, relative: string): string {
  return `skill://${SERVER_NAMESPACE}/${name}/${relative.split(path.sep).map(encodeURIComponent).join("/")}`;
}

function safeRelative(value: string): boolean {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  return Boolean(value) && normalized === value.replaceAll("\\", "/") && !normalized.startsWith("../") && normalized !== ".." && !normalized.startsWith("/");
}

function parseFrontmatter(md: string, expectedName: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(md);
  if (!match) throw new Error(`published skill ${expectedName} is missing YAML frontmatter`);
  const parsed = parseYaml(match[1]);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`published skill ${expectedName} frontmatter must be an object`);
  const frontmatter = parsed as Record<string, unknown>;
  if (frontmatter.name !== expectedName) throw new Error(`published skill directory/name mismatch: ${expectedName}`);
  if (typeof frontmatter.description !== "string" || !frontmatter.description.trim()) throw new Error(`published skill ${expectedName} needs description frontmatter`);
  return frontmatter;
}

function mimeType(relative: string): string {
  const ext = path.extname(relative).toLowerCase();
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") return "text/javascript; charset=utf-8";
  if (ext === ".yaml" || ext === ".yml") return "application/yaml; charset=utf-8";
  if (TEXT_EXTENSIONS.has(ext) || path.basename(relative) === "SKILL.md") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function shouldReturnText(relative: string, data: Buffer): boolean {
  if (path.basename(relative) === "SKILL.md" || TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase())) return !data.includes(0);
  return false;
}

async function skillRoot(): Promise<string> {
  return fs.realpath(path.join(process.cwd(), "claude-skills"));
}

async function collectFiles(root: string, name: string): Promise<SkillFile[]> {
  const dir = path.join(root, name);
  const canonical = await fs.realpath(dir).catch(() => "");
  if (!canonical || path.dirname(canonical) !== root || path.basename(canonical) !== name) throw new Error(`published skill ${name} is not a direct regular directory`);
  const rootStat = await fs.lstat(dir);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error(`published skill ${name} directory must not be a symlink`);

  const files: SkillFile[] = [];
  const queue: Array<{ absolute: string; relative: string }> = [{ absolute: dir, relative: "" }];
  let totalBytes = 0;
  while (queue.length) {
    const current = queue.shift()!;
    const entries = await fs.readdir(current.absolute, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error(`published skill ${name} contains symlink ${entry.name}`);
      const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      if (!safeRelative(relative)) throw new Error(`unsafe published skill path: ${relative}`);
      const absolute = path.join(current.absolute, entry.name);
      if (entry.isDirectory()) { queue.push({ absolute, relative }); continue; }
      if (!entry.isFile()) throw new Error(`published skill ${name} contains unsupported filesystem entry ${relative}`);
      if (files.length >= MAX_FILES_PER_SKILL) throw new Error(`published skill ${name} exceeds ${MAX_FILES_PER_SKILL} files`);
      const max = relative === "SKILL.md" ? MAX_SKILL_MD_BYTES : MAX_SUPPORTING_FILE_BYTES;
      const data = await readBoundedRegularBuffer(absolute, max);
      if (!data) throw new Error(`published skill resource ${relative} is unreadable or exceeds its size limit`);
      totalBytes += data.length;
      if (totalBytes > MAX_SKILL_TOTAL_BYTES) throw new Error(`published skill ${name} exceeds ${MAX_SKILL_TOTAL_BYTES} total bytes`);
      files.push({ relative, absolute, data, uri: skillUri(name, relative), digest: sha256(data) });
    }
  }
  const skillMd = files.find((file) => file.relative === "SKILL.md");
  if (!skillMd) throw new Error(`published skill ${name} is missing SKILL.md`);
  return [skillMd, ...files.filter((file) => file !== skillMd).sort((a, b) => a.relative.localeCompare(b.relative))];
}

async function loadSkill(name: string): Promise<LoadedSkill> {
  if (!(CHATGPT_PUBLISHED_SKILLS as readonly string[]).includes(name)) throw new Error(`unknown published skill: ${name}`);
  const root = await skillRoot();
  const files = await collectFiles(root, name);
  const skillMd = files[0];
  const frontmatter = parseFrontmatter(skillMd.data.toString("utf8"), name);
  return { name, files, entry: { uri: skillMd.uri, frontmatter, resources: files.map(({ uri, digest }) => ({ uri, digest })) } };
}

export async function listMcpSkills(cursor?: string): Promise<{ skills: SkillEntry[]; nextCursor?: string }> {
  if (cursor) throw new Error("MSO publishes one bounded skills page; nextCursor is never issued");
  const loaded = await Promise.all(CHATGPT_PUBLISHED_SKILLS.slice(0, MAX_SKILLS).map(loadSkill));
  const total = loaded.reduce((sum, skill) => sum + skill.files.reduce((bytes, file) => bytes + file.data.length, 0), 0);
  if (total > MAX_SCAN_ARCHIVE_BYTES) throw new Error(`published skill snapshot exceeds ${MAX_SCAN_ARCHIVE_BYTES} bytes`);
  return { skills: loaded.map((skill) => skill.entry) };
}

export async function getMcpSkill(uri: string): Promise<{ skill: SkillEntry }> {
  const parsed = parseSkillUri(uri);
  if (parsed.relative !== "SKILL.md") throw new Error("skills/get requires a published SKILL.md URI");
  const skill = await loadSkill(parsed.name);
  if (skill.entry.uri !== uri) throw new Error("skill URI normalization mismatch");
  return { skill: skill.entry };
}

function parseSkillUri(uri: string): { name: string; relative: string } {
  let parsed: URL;
  try { parsed = new URL(uri); } catch { throw new Error("invalid skill URI"); }
  if (parsed.protocol !== MCP_SKILL_SCHEME || parsed.hostname !== SERVER_NAMESPACE || parsed.search || parsed.hash || parsed.username || parsed.password || parsed.port) throw new Error("invalid MSO skill URI");
  const parts = parsed.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  const [name, ...rest] = parts;
  const relative = rest.join("/");
  if (!name || !safeRelative(relative) || !(CHATGPT_PUBLISHED_SKILLS as readonly string[]).includes(name)) throw new Error("unknown or unsafe MSO skill URI");
  return { name, relative };
}

export async function readMcpSkillResource(uri: string): Promise<ReadSkillResource | undefined> {
  if (!uri.startsWith(`${MCP_SKILL_SCHEME}//${SERVER_NAMESPACE}/`)) return undefined;
  const { name, relative } = parseSkillUri(uri);
  const skill = await loadSkill(name);
  const file = skill.files.find((candidate) => candidate.relative === relative && candidate.uri === uri);
  if (!file) throw new Error(`unknown skill resource: ${uri}`);
  const type = mimeType(relative);
  return shouldReturnText(relative, file.data)
    ? { uri, mimeType: type, text: file.data.toString("utf8") }
    : { uri, mimeType: type, blob: file.data.toString("base64") };
}
