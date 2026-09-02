import { randomUUID } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";

const MAX_STORE_BYTES = 1024 * 1024;
const ID_RE = /^[A-Za-z0-9_-]{1,120}$/;

export function cleanA2ACredentialLabel(value: string): string {
  const out = String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 100);
  if (!out) throw new Error("A2A credential label is required");
  return out;
}

export function cleanA2ACredentialId(value: string, field: string): string {
  const out = String(value || "").trim();
  if (!ID_RE.test(out)) throw new Error(`${field} is invalid`);
  return out;
}

export async function readA2APrivateStore<T>(
  file: string,
  empty: T,
  validate: (value: unknown) => value is T,
): Promise<T> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_STORE_BYTES)
      throw new Error("A2A credential store has an invalid file shape");
    if ((stat.mode & 0o077) !== 0)
      throw new Error(
        "A2A credential store permissions are too broad; expected 0600",
      );
    if (typeof process.getuid === "function" && stat.uid !== process.getuid())
      throw new Error("A2A credential store is not owned by the MSO user");
    const value: unknown = JSON.parse(await handle.readFile("utf8"));
    if (!validate(value))
      throw new Error("A2A credential store has an invalid schema");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty;
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function writeA2APrivateStore(
  file: string,
  value: unknown,
): Promise<void> {
  const body = JSON.stringify(value, null, 2);
  if (Buffer.byteLength(body, "utf8") > MAX_STORE_BYTES)
    throw new Error("A2A credential store exceeds 1 MiB");
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700).catch(() => undefined);
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await fs.chmod(tmp, 0o600);
  await fs.rename(tmp, file);
  await fs.chmod(file, 0o600);
}
