import { constants, promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { pinSecurityStorePath } from "../lib/security-store-path";
import { withSecurityStoreLock } from "../lib/security-store-lock";
import type { ManagedDomainConfig } from "../lib/contracts/managed-domains";
import { validateDomainConfig } from "../lib/managed-apps/domain-config";

export async function managedDomainEnvironment(file: string, input: ManagedDomainConfig, apply = false) {
  const config = validateDomainConfig(input);
  return withSecurityStoreLock(file, async () => {
    const pinned = await pinSecurityStorePath(file);
    try {
      const handle = await fs.open(pinned.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      let text: string;
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) || stat.size > 1024 * 1024) throw new Error("MSO env file must be private, owner-owned, and regular");
        text = await handle.readFile("utf8");
      } finally { await handle.close(); }
      const values = { OS_PUBLIC_ORIGIN: config.publicOrigin, NEXT_PUBLIC_MANAGED_APP_HOST_TEMPLATE: config.hostTemplate };
      let next = text;
      for (const [name, value] of Object.entries(values)) {
        next = next.replace(new RegExp(`^(?:export[ \\t]+)?${name}[ \\t]*=.*(?:\\r?\\n|$)`, "gm"), "");
        next += `${next.endsWith("\n") || !next ? "" : "\n"}${name}=${value}\n`;
      }
      const changed = next !== text;
      if (apply && changed) {
        const temporary = `${pinned.file}.${randomUUID()}.tmp`;
        try {
          const out = await fs.open(temporary, "wx", 0o600);
          try { await out.writeFile(next); await out.sync(); } finally { await out.close(); }
          await fs.rename(temporary, pinned.file);
          await pinned.directory.sync();
        } finally { await fs.unlink(temporary).catch(() => undefined); }
      }
      return { file, changed, applied: apply, values, restartRequired: changed };
    } finally { await pinned.directory.close(); }
  });
}
