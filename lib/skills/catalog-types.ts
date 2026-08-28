// The catalog's shared vocabulary. Split from catalog.ts so per-project discovery
// can depend on the types without an import cycle back through the scanner.

export const SKILL_FILE = "SKILL.md";

export const SKILL_SCAN_LIMITS = {
  /** Directory entries READ from one skill root — global or per-project. */
  maxEntriesPerRoot: 200,
  /** Projects scanned for skills per catalog call. */
  maxProjects: 60,
  /** Project skills cataloged in total. */
  maxProjectSkills: 300,
  /** A SKILL.md larger than this is skipped, not truncated: it is untrusted content
   *  and reading it is the cost we are bounding. */
  maxSkillBytes: 256 * 1024,
  /** Wall-clock ceiling for one whole catalog build. */
  maxScanMs: 4000,
  /** Signed continuation payload cap before base64/HMAC framing. */
  maxCursorBytes: 64 * 1024,
  /** A valid continuation may fast-forward only this many directory entries. */
  maxResumeEntriesPerRoot: 5_000,
  /** Semantic routing accepts bounded owner intent, never an unbounded embedding job. */
  maxSemanticQueryBytes: 4 * 1024,
  maxSemanticQueryTerms: 256,
} as const;

export type SkillTrust = "official" | "verified" | "local" | "untrusted";
export type SkillSource = "mso" | "bundled" | "operator" | "claude" | "agents" | "codex" | "openclaw" | "project";

/** A project as the skill catalog sees it. `rootId` is the container id from
 *  `lib/host/project-roots`, which is what makes two same-named projects in different
 *  configured roots distinguishable rather than collapsed. */
export type ProjectRef = { id: string; name: string; path: string; rootId: string };

export type SkillInfo = {
  /** The exact catalog id, and the ONLY key `skills_read` resolves without ambiguity.
   *  A global skill is its bare name; a project skill is `<rootId>/<project>/<name>`,
   *  so two projects — in the same root or in different ones — can ship `deploy`
   *  without either shadowing the other or an official skill. */
  id: string;
  name: string;
  path: string;
  description: string;
  source: SkillSource;
  trust: SkillTrust;
  /** Present only for a skill discovered inside a project checkout. */
  project?: ProjectRef;
  provenance?: {
    registry?: string;
    owner?: string;
    version?: string;
    sha256?: string;
  };
};

/** A resumable position in a skill scan. Positional in readdir order, like the project
 *  walk's cursor: name-ordered resume would require visiting every dirent, which is the
 *  unbounded walk the entry cap exists to prevent. */
export type SkillScanCursor = {
  /** Roots that finished CLEANLY; skipped on resume. */
  doneRoots: string[];
  /** Projects every one of whose roots finished cleanly. A partially consumed project is
   *  deliberately NOT counted here — it is re-listed and resumed at `resume`. */
  projectOffset: number;
  /** The exact dirent position inside the one root that was interrupted. */
  resume?: { root: string; entriesConsumed: number };
};

/** What a catalog build could NOT cover. Mirrors lib/host's ScanReport so the two
 *  discovery surfaces report incompleteness the same way. */
export type SkillScanReport = {
  truncated: boolean;
  truncationReasons: string[];
  scannedRoots: number;
  scannedProjects: number;
  /** Present ONLY when truncated. A cap the caller cannot resume is data loss with a
   *  label on it, so every cap emits a way to continue. */
  continuation?: {
    pendingRoots: string[];
    cursors: Array<{ root: string; entriesConsumed: number }>;
    pendingProjects: number;
    cursorSemantics: "readdir-position";
    note: string;
    cursor: string;
  };
};

export const skillIsExecutableByDefault = (skill: Pick<SkillInfo, "trust">): boolean => skill.trust !== "untrusted";
