import { ApiError } from "../host-api.ts";
import { detectShellBridge, resolveApiUrl, type ShellBridge } from "../shell-bridge.ts";

export { ApiError };
export type { ShellBridge };

export type ChangelogResponse = {
  markdown: string;
  generated: boolean;
};

export type ChangelogSection = {
  heading: string;
  items: string[];
};

export type DocsState =
  | { kind: "loading" }
  | { kind: "ready"; generated: boolean; markdown: string; sections: ChangelogSection[] }
  | { kind: "error"; message: string };

export type DocsControllerOptions = {
  fetcher?: typeof fetch;
  bridge?: ShellBridge;
};

const INVALID_RES = "The MSO changelog response is invalid.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function statusMessage(status: number): string {
  if (status === 401 || status === 403) {
    return "Your session is unavailable or this device does not have access to the changelog.";
  }
  if (status === 429) return "Too many requests. Wait a moment and retry.";
  return `MSO changelog request failed (${status}).`;
}

function cleanInlineMarkdown(raw: string): string {
  return raw
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .trim();
}

export function parseChangelogSections(markdown: string): ChangelogSection[] {
  if (!markdown || !markdown.trim()) return [];
  const sections: ChangelogSection[] = [];
  let current: ChangelogSection | null = null;
  let category: string | null = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line === "---" || line === "***") continue;

    const headingMatch = /^#{2,3}\s+(.+)$/.exec(line);
    if (headingMatch) {
      current = { heading: cleanInlineMarkdown(headingMatch[1]), items: [] };
      sections.push(current);
      category = null;
      continue;
    }

    if (/^#\s+/.test(line)) continue;

    const categoryMatch = /^\*\*([^*]+)\*\*$/.exec(line);
    if (categoryMatch && current) {
      category = categoryMatch[1].trim();
      continue;
    }

    const bulletMatch = /^[-*+]\s+(.+)$/.exec(line);
    if (bulletMatch) {
      if (!current) {
        current = { heading: "Updates", items: [] };
        sections.push(current);
      }
      const cleaned = cleanInlineMarkdown(bulletMatch[1]);
      if (cleaned) {
        current.items.push(category ? `${category}: ${cleaned}` : cleaned);
      }
      continue;
    }

    if (current) {
      const cleaned = cleanInlineMarkdown(line);
      if (cleaned) current.items.push(cleaned);
    }
  }

  return sections.filter((section) => section.items.length > 0);
}

export async function readChangelog(
  signal: AbortSignal,
  fetcher = fetch,
  bridge: ShellBridge = detectShellBridge(),
): Promise<ChangelogResponse> {
  const response = await fetcher(resolveApiUrl("/api/changelog", bridge), {
    method: "GET",
    credentials: bridge.apiBaseOrigin ? "include" : "same-origin",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    headers: { Accept: "application/json" },
  });
  const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
  if (!isJson) {
    if (!response.ok) throw new ApiError(statusMessage(response.status), response.status);
    throw new ApiError("MSO API is unavailable. Configure the local backend before retrying.", 502);
  }
  if (!response.ok) throw new ApiError(statusMessage(response.status), response.status);

  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new ApiError(INVALID_RES, 502);
  }

  if (
    !isRecord(value)
    || typeof value.markdown !== "string"
    || typeof value.generated !== "boolean"
  ) {
    throw new ApiError(INVALID_RES, 502);
  }
  return { markdown: value.markdown, generated: value.generated };
}

export function createDocsController(
  update: (state: DocsState) => void,
  options: DocsControllerOptions = {},
) {
  const fetcher = options.fetcher ?? fetch;
  let gen = 0;
  let active: AbortController | undefined;
  let disposed = false;

  async function refresh(): Promise<void> {
    if (disposed) return;
    const run = ++gen;
    active?.abort();
    const ctrl = (active = new AbortController());
    update({ kind: "loading" });
    try {
      const result = await readChangelog(ctrl.signal, fetcher, options.bridge);
      if (disposed || run !== gen) return;
      update({
        kind: "ready",
        generated: result.generated,
        markdown: result.markdown,
        sections: result.generated ? parseChangelogSections(result.markdown) : [],
      });
    } catch (error) {
      if (disposed || run !== gen || ctrl.signal.aborted) return;
      const message = error instanceof ApiError
        ? error.message
        : "Could not load changelog. Check the backend and retry.";
      update({ kind: "error", message });
    }
  }

  function dispose(): void {
    disposed = true;
    gen++;
    active?.abort();
  }

  return { refresh, dispose };
}
