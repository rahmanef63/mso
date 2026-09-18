import type { OrganizationProjectFlow } from "./organization-flow";

export type OrganizationUnitKind = "holding" | "company" | "division" | "team" | "client" | "other";
export type OrganizationStatus = "active" | "inactive";
export type OrganizationSeatMode = "permanent" | "on_demand" | "inactive";
export type OrganizationSeatState = "active" | "vacant" | "inactive";

export type OrganizationTarget =
  | { kind: "none" }
  | { kind: "project-agent"; project: string }
  | { kind: "local-agent"; ref: string }
  | { kind: "a2a"; ref: string };

export type OrganizationUnit = {
  id: string;
  key: string;
  name: string;
  kind: OrganizationUnitKind;
  status: OrganizationStatus;
  parentUnitId?: string;
  description?: string;
  projectFlow?: OrganizationProjectFlow;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type OrganizationSeat = {
  id: string;
  unitId: string;
  name: string;
  title: string;
  role: string;
  state: OrganizationSeatState;
  seatMode: OrganizationSeatMode;
  reportsToSeatId?: string;
  description?: string;
  responsibilities: string[];
  target: OrganizationTarget;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type OrganizationChart = {
  version: 1;
  name: string;
  revision: string;
  updatedAt: string;
  units: OrganizationUnit[];
  seats: OrganizationSeat[];
};

export type OrganizationSeatRuntime = {
  seatId: string;
  targetKind: OrganizationTarget["kind"];
  status: "ready" | "busy" | "offline" | "unresolved" | "unbound" | "vacant";
  label?: string;
  detail?: string;
};
