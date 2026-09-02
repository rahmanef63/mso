import { listA2ATaskRecordsForPrincipal, taskPublicView } from "./tasks";

function pageOffset(token: unknown): number {
  if (typeof token !== "string" || !token.trim()) return 0;
  try {
    const parsed = JSON.parse(
      Buffer.from(token, "base64url").toString("utf8"),
    ) as {
      offset?: unknown;
    };
    const offset = Number(parsed.offset);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error();
    return offset;
  } catch {
    throw new Error("invalid_page_token");
  }
}

function nextToken(offset: number, pageSize: number, total: number): string {
  const next = offset + pageSize;
  return next < total
    ? Buffer.from(JSON.stringify({ offset: next }), "utf8").toString(
        "base64url",
      )
    : "";
}

export async function listInboundA2ATasks(
  principal: string,
  params: Record<string, unknown>,
) {
  let rows = await listA2ATaskRecordsForPrincipal(principal);
  const contextId =
    typeof params.contextId === "string" ? params.contextId.trim() : "";
  const state = typeof params.status === "string" ? params.status.trim() : "";
  const after =
    typeof params.statusTimestampAfter === "string"
      ? Date.parse(params.statusTimestampAfter)
      : Number.NaN;
  if (contextId) rows = rows.filter((row) => row.contextId === contextId);
  if (state) rows = rows.filter((row) => row.status.state === state);
  if (Number.isFinite(after))
    rows = rows.filter((row) => Date.parse(row.status.timestamp) >= after);

  const totalSize = rows.length;
  const pageSize = Math.max(
    1,
    Math.min(100, Math.trunc(Number(params.pageSize)) || 50),
  );
  const offset = pageOffset(params.pageToken);
  if (offset > totalSize) throw new Error("invalid_page_token");
  const historyLength =
    params.historyLength === undefined
      ? 10
      : Math.max(
          0,
          Math.min(100, Math.trunc(Number(params.historyLength)) || 0),
        );
  const includeArtifacts = params.includeArtifacts === true;
  const tasks = rows.slice(offset, offset + pageSize).map((row) => {
    const view = taskPublicView(row, historyLength) as Record<string, unknown>;
    if (!includeArtifacts) delete view.artifacts;
    return view;
  });
  return {
    tasks,
    nextPageToken: nextToken(offset, pageSize, totalSize),
    pageSize,
    totalSize,
  };
}
