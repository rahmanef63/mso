import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { withSecurityStoreLock } from "@/lib/security-store-lock";
import { readWorkflowJson, writeWorkflowFile } from "@/lib/workflow/private-file";
import { ChannelError } from "./errors";

/** Separate from prunable workflow receipts; reserve before writing any durable session. */
export async function admitChannelEvent(channelId: string, eventId: string): Promise<boolean> {
  if (!eventId || eventId.length > 512) throw new ChannelError("invalid_event_id");
  const file = path.join(os.homedir(), ".mso", "private", "channel-events.json");
  const key = createHash("sha256").update(JSON.stringify([channelId, eventId])).digest("hex");
  return withSecurityStoreLock(file, async () => {
    let receipts: Record<string, number>;
    try { receipts = await readWorkflowJson(file, 1024 * 1024, "channel event admission") as Record<string, number>; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; receipts = {}; }
    for (const [id, expiry] of Object.entries(receipts)) {
      if (!/^[a-f0-9]{64}$/.test(id) || !Number.isSafeInteger(expiry)) throw new ChannelError("invalid_event_admission_store");
      if (expiry <= Date.now()) delete receipts[id];
    }
    if (receipts[key]) return false;
    if (Object.keys(receipts).length >= 4096) throw new ChannelError("event_admission_capacity", 429);
    receipts[key] = Date.now() + 10 * 60 * 1000;
    await writeWorkflowFile(file, JSON.stringify(receipts));
    return true;
  });
}
