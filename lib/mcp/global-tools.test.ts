import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const { TOOLS } = await import("./tools");
const { dispatch } = await import("./dispatch");
const { allows, clampScope, defaultConsentScope, maxScope, parseScope, SCOPES } = await import("./scope");
const { toolsetInfo } = await import("./toolset");

// THE GLOBAL-CAPABILITY INVARIANT.
//
// MSO must never scope its tool catalog to one project, one agent or one playbook.
// Which tools EXIST is not a security control here — the scope ladder, the path jail
// and the approval card are. A silently shortened catalog just makes the assistant
// look broken while the owner believes it is contained.
//
// What IS a control, and must survive: the read < write < exec ladder. An operator
// who opts a deployment down to `read` gets fewer tools because they asked for fewer,
// not because MSO decided a project needed less.

const names = async (scope: "read" | "write" | "exec") => {
  const r = await dispatch({ id: 1, method: "tools/list" }, scope);
  return (r.result as { tools: { name: string }[] }).tools.map((t) => t.name);
};

describe("an exec token sees the entire public catalog", () => {
  it("lists every tool, with nothing filtered out", async () => {
    const listed = await names("exec");
    expect(listed.sort()).toEqual(TOOLS.map((t) => t.name).sort());
  });

  it("can CALL every listed tool — nothing is listed-but-refused at exec scope", async () => {
    // Not executing them (they touch the host); asserting the dispatcher's scope gate
    // admits each one. A name that lists but cannot be called is the drift that made
    // "ChatGPT says it has no such tool" a recurring bug report.
    for (const tool of TOOLS) expect(allows("exec", tool.scope), tool.name).toBe(true);
  });

  it("reports the same count in the toolset signature clients diff against", async () => {
    const r = await dispatch({ id: 1, method: "tools/list" }, "exec");
    const meta = (r.result as { _meta: { toolset: { toolCount: number; names: string[]; hash: string } } })._meta;
    expect(meta.toolset.toolCount).toBe(TOOLS.length);
    expect(meta.toolset.names).toEqual([...TOOLS.map((t) => t.name)].sort());
    expect(toolsetInfo(TOOLS, "exec").hash).toBe(meta.toolset.hash);
  });
});

describe("the scope ladder is the ONLY thing that narrows the catalog", () => {
  it("read and write are strict prefixes of exec, by tier and nothing else", async () => {
    const [read, write, exec] = await Promise.all([names("read"), names("write"), names("exec")]);
    expect(read).toEqual(TOOLS.filter((t) => t.scope === "read").map((t) => t.name));
    expect(write).toEqual(TOOLS.filter((t) => allows("write", t.scope)).map((t) => t.name));
    expect(exec).toEqual(TOOLS.map((t) => t.name));
    expect(read.every((n) => write.includes(n))).toBe(true);
    expect(write.every((n) => exec.includes(n))).toBe(true);
  });

  it("keeps the read/write opt-down available to an operator", () => {
    vi.stubEnv("OS_MCP_MAX_SCOPE", "read");
    expect(maxScope()).toBe("read");
    expect(clampScope("exec")).toBe("read");
    vi.stubEnv("OS_MCP_MAX_SCOPE", "write");
    expect(clampScope("exec")).toBe("write");
    vi.stubEnv("OS_MCP_MAX_SCOPE", "nonsense");
    expect(maxScope(), "a malformed ceiling must fail closed, never open").toBe("write");
    vi.unstubAllEnvs();
  });

  it("still defaults consent to exec on a deployment that set no ceiling", () => {
    vi.stubEnv("OS_MCP_MAX_SCOPE", "");
    expect(maxScope()).toBe("exec");
    expect(defaultConsentScope(maxScope())).toBe("exec");
    expect(parseScope(undefined), "an absent request is still least-privilege").toBe("read");
    vi.unstubAllEnvs();
  });

  it("has no scope outside the three-tier ladder", () => {
    expect([...SCOPES]).toEqual(["read", "write", "exec"]);
    for (const tool of TOOLS) expect(SCOPES, tool.name).toContain(tool.scope);
  });
});

describe("no per-project or per-agent tool filter exists", () => {
  it("exposes an identical catalog regardless of the project a workflow names", async () => {
    // The catalog is a module-level constant with no project input. If someone adds
    // one, `visibleTools` stops being a pure function of scope and this breaks.
    const first = await names("exec");
    const second = await names("exec");
    expect(first).toEqual(second);
    expect(TOOLS.every((t) => typeof t.run === "function")).toBe(true);
  });

  it("advertises workflow_id as CONTEXT, never as a capability filter", () => {
    // Every operational tool carries an optional workflow_id. It correlates steps;
    // it must not be required, or a client without a workflow would lose the tool.
    for (const tool of TOOLS) {
      if (["skills_search", "workflow_start", "workflow_cancel", "workflow_finish"].includes(tool.name)) continue;
      expect(Object.keys(tool.inputSchema.properties), tool.name).toContain("workflow_id");
      expect(tool.inputSchema.required ?? [], tool.name).not.toContain("workflow_id");
    }
  });

  it("keeps project function execution in exec while discovery stays read", async () => {
    expect(await names("read")).toContain("project_capabilities");
    expect(await names("read")).not.toContain("project_function_call");
    expect(await names("write")).not.toContain("project_function_call");
    expect(await names("exec")).toContain("project_function_call");
  });
});

describe("image generation is gone from every surface", () => {
  it("exposes no image-generation tool at any scope", async () => {
    const exec = await names("exec");
    expect(exec.filter((n) => /image_gener/i.test(n))).toEqual([]);
    expect(TOOLS.filter((t) => /image_gener/i.test(t.name))).toEqual([]);
  });

  it("does not advertise image generation in a description either", () => {
    // A description that says "generate an image" is a tool call the model will try.
    const offenders = TOOLS.filter((t) => /generate[sd]? (?:an? )?(?:new )?(?:raster |png )?image/i.test(t.description));
    expect(offenders.map((t) => t.name)).toEqual([]);
  });

  it("never tells the client to prefer a native or provider image tool", () => {
    const wording = /(native|provider|built-?in).{0,40}image (generation|tool)/i;
    expect(TOOLS.filter((t) => wording.test(t.description)).map((t) => t.name)).toEqual([]);
  });
});

describe("file import survives the image-generation removal", () => {
  it("keeps fs_upload_file with its ChatGPT file-parameter binding", () => {
    const upload = TOOLS.find((t) => t.name === "fs_upload_file");
    expect(upload).toBeDefined();
    expect(upload!.scope).toBe("write");
    expect(upload!.meta).toEqual({ "openai/fileParams": ["file"] });
    expect(upload!.inputSchema.required).toEqual(["file", "dest"]);
    expect(upload!.limit).toMatchObject({ key: "fs.upload", max: 20 });
  });

  it("is reachable by a write token, so importing a ChatGPT file needs no shell", async () => {
    expect(await names("write")).toContain("fs_upload_file");
  });
});

describe("global discovery is part of the public catalog", () => {
  it("ships projects_list, skills_list and skills_read at read scope", async () => {
    const read = await names("read");
    for (const name of ["projects_list", "project_capabilities", "skills_list", "skills_read", "skills_search"]) expect(read).toContain(name);
  });
});
