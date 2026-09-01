import { describe, expect, it } from "vitest";
import { approvesTool, nextPermissionMode, permissionCompletionItems, permissionMode } from "./mso-agent-permissions.mjs";

describe("MSO Agent permission modes", () => {
  it("parses stable human aliases without numeric-only UX", () => {
    expect(permissionMode("ask")?.id).toBe("ask");
    expect(permissionMode("a")?.id).toBe("ask");
    expect(permissionMode("auto-write")?.id).toBe("auto");
    expect(permissionMode("w")?.id).toBe("auto");
    expect(permissionMode("yolo")?.id).toBe("yolo");
    expect(permissionMode("y")?.id).toBe("yolo");
    expect(permissionMode("3")).toBeNull();
  });

  it("keeps ask strict, auto-write scoped, and yolo explicit", () => {
    expect(approvesTool("ask", "write")).toBe(false);
    expect(approvesTool("auto", "write")).toBe(true);
    expect(approvesTool("auto", "exec")).toBe(false);
    expect(approvesTool("yolo", "exec")).toBe(true);
    expect(nextPermissionMode("yolo").id).toBe("ask");
  });

  it("builds an arrow-picker catalog", () => {
    const all = permissionCompletionItems("");
    expect(all.map((row) => row.value)).toEqual(["ask", "auto", "yolo"]);
    expect(permissionCompletionItems("write").map((row) => row.value)).toEqual(["ask", "auto", "yolo"]);
    expect(permissionCompletionItems("danger").map((row) => row.value)).toEqual([]);
  });
});
