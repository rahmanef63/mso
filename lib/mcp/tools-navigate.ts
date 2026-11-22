import { type McpTool, str, opt, S, PATH_P, READ_ONLY } from "./tool-kit";
import { grepFs, globFs } from "@/lib/host/fs-grep";

export const NAVIGATE_TOOLS: McpTool[] = [
  {
    name: "fs_grep",
    description:
      "Search file contents across a directory tree using a JavaScript regular expression. " +
      "Bounded to OS_FS_READ_ROOTS, skips files > 1 MiB, binary files, node_modules, .git, .next, coverage, and credential paths. " +
      "Returns matching lines with 1-based line numbers.",
    scope: "read",
    annotations: READ_ONLY,
    result: {
      maxTextBytes: 64 * 1024,
      overflowHint: "Narrow search with a more specific pattern, path, or glob filter.",
    },
    inputSchema: S({
      pattern: { type: "string", description: "JavaScript regular expression to match against file contents line by line." },
      ...PATH_P,
      glob: { type: "string", description: "Optional glob pattern to filter files (e.g. '**/*.ts', 'src/**/*.tsx')." },
      max_matches: { type: "number", description: "Maximum matching lines to return. Default 200, hard cap 1000." },
      case_sensitive: { type: "boolean", description: "Whether the regex match is case-sensitive. Default true." },
    }, ["pattern"]),
    run: (a) =>
      grepFs({
        pattern: str(a, "pattern"),
        path: opt(a, "path"),
        glob: opt(a, "glob"),
        max_matches: typeof a.max_matches === "number" ? a.max_matches : undefined,
        case_sensitive: typeof a.case_sensitive === "boolean" ? a.case_sensitive : undefined,
      }),
  },
  {
    name: "fs_glob",
    description:
      "Find files matching a glob pattern across a directory tree. " +
      "Bounded to OS_FS_READ_ROOTS, skips node_modules, .git, .next, coverage, and credential paths. " +
      "Returns sorted file paths.",
    scope: "read",
    annotations: READ_ONLY,
    result: {
      maxTextBytes: 64 * 1024,
      overflowHint: "Narrow search with a more specific glob pattern or path.",
    },
    inputSchema: S({
      pattern: { type: "string", description: "Glob pattern to match file paths (e.g. '**/*.test.ts', 'src/**/*.ts')." },
      ...PATH_P,
      max_results: { type: "number", description: "Maximum matching paths to return. Default 200, hard cap 1000." },
    }, ["pattern"]),
    run: (a) =>
      globFs({
        pattern: str(a, "pattern"),
        path: opt(a, "path"),
        max_results: typeof a.max_results === "number" ? a.max_results : undefined,
      }),
  },
];
