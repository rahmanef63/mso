import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { normaliseServiceTokenConstraints, normaliseServiceTokenTools } from "./service-token";

describe("restricted MCP service tokens", () => {
  it("accepts only known tools within the granted scope", () => {
    expect(normaliseServiceTokenTools(["project_capabilities", "project_function_call", "project_capabilities"], "exec"))
      .toEqual(["project_capabilities", "project_function_call"]);
    expect(() => normaliseServiceTokenTools(["project_function_call"], "read")).toThrow(/needs exec scope/);
    expect(() => normaliseServiceTokenTools(["exec_run"], "exec")).toThrow(/not eligible for service tokens/);
    const constraints=normaliseServiceTokenConstraints({project_capabilities:{project:["antinrml-game"]},project_function_call:{project:["antinrml-game"],name:["capture_scene"]}},["project_capabilities","project_function_call"]);
    expect(constraints?.project_function_call.name).toEqual(["capture_scene"]);
    expect(() => normaliseServiceTokenConstraints({exec_run:{command:["id"]}},["project_capabilities","project_function_call"])).toThrow(/not allowlisted/);
    expect(() => normaliseServiceTokenConstraints(undefined,["project_function_call"])).toThrow(/constraints/);
    expect(() => normaliseServiceTokenConstraints({project_function_call:{project:["antinrml-game"]}},["project_function_call"])).toThrow(/name/);
  });
});
