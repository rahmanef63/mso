export type WorkflowDiscoveryRow = {
  id: string; name: string; status: string; project?: string; updatedAt: string;
  originPrincipal: string; owner: string; revision: string; readOnly: boolean; nodeCount: number;
};
export type WorkflowDiscoveryPage = {
  graphs: WorkflowDiscoveryRow[];
  scan: { ownerOffset: number; nextOwnerOffset?: number; ownersScanned: number; totalOwners: number; warnings: string[] };
};
