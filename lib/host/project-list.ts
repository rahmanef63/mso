// The paginated, metadata-bearing view of the walk. Kept apart from project-roots.ts so
// the walk stays about containment and budgets, and this stays about presentation.
import path from "path";
import { boundedGitMeta, packageMeta } from "./project-meta";
import { projectCapabilities } from "./project-capabilities";
import { PROJECT_LIMITS, type ProjectRow, type ScanReport } from "./project-containers";
import { decodeCursor } from "./project-cursor";
import { listProjectDirs } from "./project-roots";

export type ListProjectsResult = {
  roots: string[];
  containers: Array<{ id: string; path: string; derived: boolean; authorizedRoot: string }>;
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset?: number;
  scan: ScanReport;
  projects: ProjectRow[];
};

/** Bounded, paginated enumeration. Metadata is read only for the returned PAGE —
 *  `total` counts directories, so a wide box does not pay for 400 package reads. */
export async function listProjects(
  options: { query?: string; limit?: number; offset?: number; cursor?: string } = {},
): Promise<ListProjectsResult> {
  const { containers, dirs, scan } = await listProjectDirs(decodeCursor(options.cursor));
  const query = options.query?.trim().toLowerCase();
  const matched = query ? dirs.filter(({ dir }) => path.basename(dir).toLowerCase().includes(query)) : dirs;
  const limit = Math.min(Math.max(Math.round(options.limit ?? PROJECT_LIMITS.defaultPageSize), 1), PROJECT_LIMITS.maxPageSize);
  const offset = Math.max(Math.round(options.offset ?? 0), 0);
  const page = matched.slice(offset, offset + limit);
  const projects = await Promise.all(page.map(async ({ container, dir }) => {
    const [pkg, git, capabilities] = await Promise.all([packageMeta(dir), boundedGitMeta(dir), projectCapabilities(dir)]);
    const name = path.basename(dir);
    return {
      id: `${container.id}/${name}`,
      name,
      path: dir,
      rootId: container.id,
      root: container.path,
      authorizedRoot: container.authorizedRoot,
      ...(pkg.name ? { packageName: pkg.name } : {}),
      ...(pkg.version ? { packageVersion: pkg.version } : {}),
      ...(git.available ? { git: { branch: git.branch, head: git.head?.sha?.slice(0, 12) } } : {}),
      ...(capabilities ? { capabilities } : {}),
    };
  }));
  const hasMore = offset + page.length < matched.length;
  return {
    roots: containers.map((c) => c.path),
    containers: containers.map(({ id, path: p, derived, authorizedRoot }) => ({ id, path: p, derived, authorizedRoot })),
    total: matched.length,
    offset,
    limit,
    hasMore,
    ...(hasMore ? { nextOffset: offset + page.length } : {}),
    scan,
    projects,
  };
}

