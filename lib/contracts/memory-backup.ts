export type MemoryBackupScan = { files: number; bytes: number; missing: number; rejected: number; excluded: number; truncated: boolean };
export type MemoryBackupSummary = {
  id: string; state: "snapshot" | "partial"; createdAt: string; directory: string; manifestSha256: string;
  scan: MemoryBackupScan; compressedBytes: number; sourceDiscoveryTruncated: boolean;
  consistency: "per-file-verified-not-point-in-time"; offsite: false;
};
export type MemoryBackupVerification = { id: string; integrity: boolean; restoredFiles: number; restoreDirectory: string; complete: boolean; sourceWritesPerformed: 0 };
