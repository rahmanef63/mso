import { createHash } from "node:crypto";
import { readBoundedRegularBufferOrThrow } from "@/lib/host/bounded-read";

export async function forgeTargetHash(file: string): Promise<string> {
  try {
    const data = await readBoundedRegularBufferOrThrow(file, 512 * 1024);
    return createHash("sha256").update(data).digest("hex");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "invalid";
  }
}
