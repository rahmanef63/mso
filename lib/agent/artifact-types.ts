import type { ArtifactOwner } from "./artifact-paths";
export type ArtifactInput = {
  project: string;
  feature: string;
  environment?: string;
  locale?: string;
  width?: number;
  height?: number;
  url?: string;
  workflowId?: string;
  producer?: "playwright" | "camoufox" | "mso" | "other";
};
export type SessionArtifact = ArtifactInput & {
  id: string;
  filename: string;
  relativePath: string;
  kind: "screenshot" | "report";
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "application/json";
  bytes: number;
  sha256: string;
  createdAt: string;
};
export type ArtifactManifest = {
  version: 1;
  sessionId: string;
  principalHash: string;
  updatedAt: string;
  leaseUntil: string;
  artifacts: SessionArtifact[];
};
export function emptyArtifactManifest(owner: ArtifactOwner): ArtifactManifest {
  return {
    version: 1,
    sessionId: owner.id,
    principalHash: owner.principalHash,
    updatedAt: new Date(0).toISOString(),
    leaseUntil: new Date(0).toISOString(),
    artifacts: [],
  };
}
