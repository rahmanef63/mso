export type CleanupItem = {
  id: string;
  label: string;
  desc: string;
  bytes: number;
  available: boolean;
};

export type CleanupPreview = {
  items: CleanupItem[];
  previewId: string;
  expiresAt: string;
  protectedTargets: string[];
};

export type CleanupRunResult = {
  id: string;
  ok: boolean;
  freedBytes: number;
  error?: string;
};

export type FederationStatus = {
  running: boolean;
  connected: boolean;
  lastPollAt?: number;
  lastHeartbeatAt?: number;
  lastSuccessAt?: number;
  lastError?: string;
  currentRequestId?: string;
  lastRequestId?: string;
  lastOutcome?: "idle" | "succeeded" | "failed";
  consecutiveFailures: number;
  nextPollInMs?: number;
  batonProject?: string;
  msoToolCount: number;
  siCoderFunctionCount?: number;
  siCoderVersion?: string;
};

export type UpdateAutomationView = {
  prefs: { auto: boolean; channel: "stable" | "main" };
  timer: { installed: boolean; enabled: boolean; active: boolean; nextRun: string | null };
  active: boolean;
  last: {
    lastAttemptAt: number | null;
    lastResult: "ok" | "failed" | "skipped" | null;
    consecutiveFailures: number;
    detail: string | null;
    channel: "stable" | "main" | null;
  };
  drift: string | null;
  supported: boolean;
  reason: string | null;
};
