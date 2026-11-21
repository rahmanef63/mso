import { describe, expect, it } from "vitest";
import { createAppApp } from "./index";

describe("create-app slice contract", () => {
  it("exposes a lazy-loaded AppDescriptor with bounded default dimensions", () => {
    expect(createAppApp.id).toBe("create-app");
    expect(createAppApp.title).toBe("Create App");
    expect(typeof createAppApp.load).toBe("function");
    expect(createAppApp.defaultSize).toEqual({ w: 520, h: 560 });
  });
});
