// Shared shape for agent-created demo logins. A demo user is NOT an API credential:
// it models a throwaway login for a site the owner asked MSO to test.
//
// `password` is a secret. Only the agent-side record read and the human reveal path
// may return it; every list/summary result carries `hasPassword` instead.
export type DemoCredentialRecord = {
  id: string;
  /** Credential owner resolved from the workspace folder binding. */
  owner: string;
  /** Canonical bound folder path that scopes this demo user. */
  workspace: string;
  email: string;
  password: string;
  label?: string;
  site?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
};

export type DemoCredentialSummary = Omit<DemoCredentialRecord, "password"> & { hasPassword: true };
