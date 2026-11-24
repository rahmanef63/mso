export type MemoryFact = { id: string; text: string; createdAt: number };

export type MemoryBackupScan = {
  files: number;
  bytes: number;
  missing: number;
  rejected: number;
  excluded: number;
  truncated: boolean;
};

export type MemoryBackupSummary = {
  id: string;
  state: "snapshot" | "partial";
  createdAt: string;
  directory: string;
  manifestSha256: string;
  scan: MemoryBackupScan;
  compressedBytes: number;
  sourceDiscoveryTruncated: boolean;
};

export type MemoryBackupVerification = {
  id: string;
  integrity: boolean;
  restoredFiles: number;
  restoreDirectory: string;
  complete: boolean;
  sourceWritesPerformed: number;
};

export type MemoryBackupHistoryEntry =
  | {
      id: string;
      status: "readable";
      snapshot: MemoryBackupSummary;
      integrity: "not-recorded" | "verified-at-recorded-time" | "receipt-invalid";
      verifiedAt?: string;
    }
  | { id: string; status: "unreadable"; error: string };
