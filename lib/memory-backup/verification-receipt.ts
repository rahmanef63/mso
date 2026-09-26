import path from "node:path";
import { readBytes, writeExclusive } from "./io";
import { BACKUP_ID, type Manifest, snapshotComplete } from "./manifest";
import type { MemoryBackupVerification } from "@/lib/contracts/memory-backup";

type Receipt = { version: 1; manifestSha256: string; verifiedAt: string; result: MemoryBackupVerification };
export type IntegrityRecord = { integrity: "not-recorded" | "verified-at-recorded-time" | "receipt-invalid"; verifiedAt?: string };
const receiptPath = (directory: string, sha: string) => path.join(directory, `verification-${sha}.json`);
function valid(value: unknown, directory: string, sha: string, manifest?: Manifest): value is Receipt {
  const r = value as Receipt, v = r?.result;
  return !!r && r.version === 1 && r.manifestSha256 === sha && typeof r.verifiedAt === "string" && Number.isFinite(Date.parse(r.verifiedAt)) &&
    !!v && v.id === path.basename(directory) && v.integrity === true && v.sourceWritesPerformed === 0 && typeof v.complete === "boolean" &&
    Number.isSafeInteger(v.restoredFiles) && v.restoredFiles >= 0 && typeof v.restoreDirectory === "string" &&
    path.dirname(v.restoreDirectory) === directory && path.basename(v.restoreDirectory).startsWith("restore-check-") &&
    BACKUP_ID.test(path.basename(v.restoreDirectory).slice("restore-check-".length)) &&
    (!manifest || (v.restoredFiles === manifest.entries.length && v.complete === snapshotComplete(manifest)));
}
/** Immutable receipt of a completed rehearsal; never a claim of current re-verification. */
export async function recordVerification(directory: string, sha: string, result: MemoryBackupVerification) {
  const receipt: Receipt = { version: 1, manifestSha256: sha, verifiedAt: new Date().toISOString(), result };
  try { await writeExclusive(receiptPath(directory, sha), Buffer.from(JSON.stringify(receipt))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const prior: unknown = JSON.parse((await readBytes(receiptPath(directory, sha), 4096)).toString("utf8"));
    if (!valid(prior, directory, sha) || prior.result.restoredFiles !== result.restoredFiles || prior.result.complete !== result.complete) {
      throw new Error("invalid existing verification receipt; restore evidence preserved");
    }
  }
}
export async function readVerification(directory: string, sha: string, manifest: Manifest): Promise<IntegrityRecord> {
  try {
    const receipt: unknown = JSON.parse((await readBytes(receiptPath(directory, sha), 4096)).toString("utf8"));
    return valid(receipt, directory, sha, manifest)
      ? { integrity: "verified-at-recorded-time", verifiedAt: receipt.verifiedAt }
      : { integrity: "receipt-invalid" };
  } catch (error) {
    return { integrity: (error as NodeJS.ErrnoException).code === "ENOENT" ? "not-recorded" : "receipt-invalid" };
  }
}
