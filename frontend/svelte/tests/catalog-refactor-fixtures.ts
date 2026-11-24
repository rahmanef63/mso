// Fixtures for catalog-refactor.test.ts. Kept out of the test file so
// the suite stays under the repository's file-length ratchet.

import type { AppCatalogSnapshot } from "../src/lib/catalog/catalog-api.ts";

export const signal = new AbortController().signal;

export const jsonFetch = (body: unknown): typeof fetch => async () =>
  ({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), json: async () => body } as Response);

export const snapshot: AppCatalogSnapshot = {
  status: "remote",
  entries: [
    { kind: "managed", id: "n8n" },
    { kind: "managed", id: "hermes" },
    {
      kind: "connected",
      manifest: {
        id: "grafana", name: "Grafana Dashboards",
        description: "Metrics and observability portal", launchUrl: "https://grafana.example.com",
      },
    },
  ],
};

export const marketPayload = {
  root: "/home/operator/.mso/skills",
  skills: [
    {
      id: "ponytail", title: "Ponytail", description: "Minimalist senior-dev coding mode.",
      version: "4.9.0", source: "@dietrichgebert/ponytail", security: "clean",
      state: "not-installed", canInstall: true, canRemove: false,
    },
    {
      id: "rtk", title: "RTK", description: "Compress verbose shell output.",
      version: "1", source: "mso-curated/rtk", security: "mso-safe-wrapper",
      state: "installed", canInstall: true, canRemove: true,
    },
  ],
};
