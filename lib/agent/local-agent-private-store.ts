import { randomUUID } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";

export async function readLocalAgentStore<T>(
  file: string,
  maxBytes: number,
  fallback: T,
  valid: (value: unknown) => value is T,
): Promise<T> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes)
      throw new Error("local agent store has an invalid file shape");
    if ((stat.mode & 0o077) !== 0)
      throw new Error("local agent store permissions are too broad; expected 0600");
    if (typeof process.getuid === "function" && stat.uid !== process.getuid())
      throw new Error("local agent store is not owned by the MSO user");
    const value = JSON.parse(await handle.readFile("utf8")) as unknown;
    if (!valid(value)) throw new Error("local agent store has an invalid schema");
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(fallback);
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export async function writeLocalAgentStore(file: string, value: unknown, maxBytes: number): Promise<void> {
  const body = JSON.stringify(value, null, 2);
  if (Buffer.byteLength(body, "utf8") > maxBytes)
    throw new Error("local agent store exceeds its size budget");
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.chmod(dir, 0o700).catch(() => undefined);
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, body, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await fs.chmod(tmp, 0o600);
  await fs.rename(tmp, file);
  await fs.chmod(file, 0o600);
}
