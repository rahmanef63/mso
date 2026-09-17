"use client";

import dynamic from "next/dynamic";

// Preserve the public API without eagerly importing the graph through the app descriptor.
// Used by Alfa's Organization tab; the standalone app still loads its own view directly.
export const OrganizationView = dynamic(
  () => import("./components/organization-view").then((module) => module.OrganizationView),
  { ssr: false, loading: () => <p role="status" className="p-4 text-sm text-muted-foreground">Loading organization…</p> },
);
