// The project WALK: bounded enumeration of the containers project-containers.ts
// authorized, plus a truthful, LOSSLESSLY RESUMABLE report of everything it could not
// cover.
//
// Four rules earned the hard way:
//   1. `truncated:false` means "this is all of it". Any cap sets `truncated:true` with a
//      named reason — a silent slice that claims completeness is how a model ends up
//      telling the owner a project does not exist.
//   2. EVERY dirent counts against the entry cap, accepted or not. Counting only the
//      entries we kept meant a container of a million regular files still cost a million
//      iterations before the "400 entry" cap was reached.
//   3. ONE STREAMING PASS. Entries are validated as they arrive and the position advances
//      only AFTER an entry is fully processed. The previous version read every name,
//      sorted them, then validated — so a cap or deadline that tripped during validation
//      left the cursor pointing past names nothing had looked at, and they were lost.
//   4. Caps are addressed by (rootIndex, containerIndex, entriesConsumed), where
//      rootIndex indexes the UNCAPPED configured-root list. Without that, `maxRoots`
//      could never advance: every call rebuilt the same capped prefix.
import { promises as fs } from "fs";
import path from "path";
import { validateProjectChild } from "./project-candidate";
import { encodeCursor } from "./project-cursor";
import {
  allConfiguredRoots, overflowRoots, projectContainers,
  PROJECT_LIMITS, type ProjectContainer, type ScanCursor, type ScanReport,
} from "./project-containers";

export {
  allConfiguredRoots, authorizedRoots, configuredRootPaths, containerById, containerFor,
  projectContainers, projectRoots, shortId, PROJECT_LIMITS,
} from "./project-containers";
export type { AuthorizedRoot, ProjectContainer, ProjectRow, ScanReport, ScanCursor } from "./project-containers";
export { decodeCursor, encodeCursor } from "./project-cursor";

type StopReason = "maxEntriesPerRoot" | "maxProjects" | "deadline";
type Walk = {
  dirs: string[];
  /** Raw dirents FULLY PROCESSED. Never includes one a cap stopped us before validating. */
  consumed: number;
  stop?: StopReason;
  skipped: number;
};

/**
 * One streaming `opendir` pass. `skipEntries` fast-forwards to a recorded position, and
 * `budget` is how many more projects the whole scan may still accept.
 */
async function walkContainer(
  container: ProjectContainer,
  containerPaths: Set<string>,
  skipEntries: number,
  deadlineAt: number,
  budget: number,
): Promise<Walk> {
  const dirs: string[] = [];
  let consumed = skipEntries;
  let seen = 0;
  let processed = 0;
  let skipped = 0;
  let stop: StopReason | undefined;
  const handle = await fs.opendir(container.path).catch(() => null);
  if (!handle) return { dirs, consumed, skipped };
  try {
    for await (const entry of handle) {
      seen += 1;
      if (seen <= skipEntries) continue;
      // Every check happens BEFORE the entry is processed, so stopping here leaves
      // `consumed` on the last fully-handled dirent and this one is re-read next time.
      if (processed >= PROJECT_LIMITS.maxEntriesPerRoot) { stop = "maxEntriesPerRoot"; break; }
      if (Date.now() > deadlineAt) { stop = "deadline"; break; }
      if (dirs.length >= budget) { stop = "maxProjects"; break; }

      processed += 1;
      const full = path.join(container.path, entry.name);
      // `~/projects` under `~` is a CONTAINER, not a project inside its parent.
      if (containerPaths.has(full)) skipped += 1;
      else if (!entry.isDirectory() || entry.name.startsWith(".")) skipped += 1;
      else {
        const candidate = await validateProjectChild(container, entry.name);
        if (candidate.ok) dirs.push(candidate.path);
        else skipped += 1;
      }
      consumed = seen; // ONLY now — the entry is fully handled.
    }
  } catch {
    // A directory that vanishes mid-walk yields what we already fully processed.
  }
  return { dirs, consumed, stop, skipped };
}

export type ProjectDirs = {
  containers: ProjectContainer[];
  dirs: Array<{ container: ProjectContainer; dir: string }>;
  scan: ScanReport;
};

const complete = (rootCount: number): ScanCursor => ({ rootIndex: rootCount, containerIndex: 0, entriesConsumed: 0 });

/** The one walk. `listProjectDirs()` is this over every discovered container; an explicit
 *  `rootHint` is this over exactly one. */
export async function listProjectDirsIn(
  containers: ProjectContainer[],
  options: { explicit?: boolean; cursor?: ScanCursor; startIndex?: number } = {},
): Promise<ProjectDirs> {
  const deadlineAt = Date.now() + PROJECT_LIMITS.maxScanMs;
  const startIndex = options.startIndex ?? 0;
  const dirs: Array<{ container: ProjectContainer; dir: string }> = [];
  const reasons: string[] = [];
  const scannedRoots: string[] = [];
  const overflow = options.explicit ? { roots: [], nextIndex: startIndex } : await overflowRoots(startIndex);
  const skippedRoots = [...overflow.roots];
  const containerPaths = new Set(containers.map((c) => c.path));
  const cursor = options.cursor;
  const pendingRoots: string[] = [];
  let position: ScanCursor | undefined;
  let skippedProjects = 0;

  for (const container of containers) {
    // A recorded position addresses one exact container; earlier ones are already done.
    if (cursor && (container.rootIndex < cursor.rootIndex
      || (container.rootIndex === cursor.rootIndex && container.containerIndex < cursor.containerIndex))) continue;
    const resumeHere = cursor
      && container.rootIndex === cursor.rootIndex
      && container.containerIndex === cursor.containerIndex
      && (!cursor.containerPath || cursor.containerPath === container.path);
    const skipEntries = resumeHere ? cursor!.entriesConsumed : 0;

    if (Date.now() > deadlineAt) {
      reasons.push("deadline");
      position = { rootIndex: container.rootIndex, containerIndex: container.containerIndex, entriesConsumed: skipEntries, containerPath: container.path };
      pendingRoots.push(...containers.slice(containers.indexOf(container)).map((c) => c.path));
      break;
    }

    const walk = await walkContainer(container, containerPaths, skipEntries, deadlineAt, PROJECT_LIMITS.maxProjects - dirs.length);
    scannedRoots.push(container.path);
    skippedProjects += walk.skipped;
    for (const dir of walk.dirs) dirs.push({ container, dir });

    if (walk.stop) {
      reasons.push(walk.stop === "maxEntriesPerRoot" ? `maxEntriesPerRoot:${container.path}` : walk.stop);
      position = { rootIndex: container.rootIndex, containerIndex: container.containerIndex, entriesConsumed: walk.consumed, containerPath: container.path };
      pendingRoots.push(...containers.slice(containers.indexOf(container)).map((c) => c.path));
      break;
    }
  }

  // Nothing stopped mid-container, so the next position is the first root this scan
  // could not honour — which is how `maxRoots` finally becomes continuable.
  if (!position && overflow.roots.length) {
    reasons.push("maxRoots");
    pendingRoots.push(...overflow.roots.map((r) => r.path));
    position = { rootIndex: overflow.nextIndex, containerIndex: 0, entriesConsumed: 0 };
  }

  const truncationReasons = [...new Set(reasons)];
  const rootCount = (await allConfiguredRoots()).length;
  return {
    containers,
    dirs: dirs.sort((a, b) => a.container.path.localeCompare(b.container.path) || a.dir.localeCompare(b.dir)),
    scan: {
      truncated: truncationReasons.length > 0,
      truncationReasons,
      scannedRoots,
      skippedRoots,
      skippedProjects,
      ...(truncationReasons.length ? {
        continuation: {
          pendingRoots: [...new Set(pendingRoots)],
          position: position ?? complete(rootCount),
          cursorSemantics: "readdir-stream-position" as const,
          note: "Pass `cursor` back to resume at the exact dirent the scan stopped on. Positions are readdir stream order and are valid while the directories are unchanged.",
          cursor: encodeCursor(position ?? complete(rootCount)),
        },
      } : {}),
    },
  };
}

/** Every project directory across every container, in container-then-name order. */
export async function listProjectDirs(cursor?: ScanCursor): Promise<ProjectDirs> {
  const startIndex = cursor?.rootIndex ?? 0;
  return listProjectDirsIn(await projectContainers(startIndex), { cursor, startIndex });
}
