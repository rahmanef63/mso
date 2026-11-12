import { describe, expect, it } from "vitest";
import {
  CONNECTION_ADDRESS_PARAMS,
  connectionAddressFrom,
  connectionAddressLabel,
  connectionAddressPath,
} from "./connection-address";

const sample = { provider: "github", user: "studio", connection: "delivery" };

describe("connection address", () => {
  it("names provider, owner and connection in one copyable route", () => {
    expect(connectionAddressPath(sample)).toBe("/integrations?provider=github&user=studio&connection=delivery");
    expect(CONNECTION_ADDRESS_PARAMS.every((name) => connectionAddressPath(sample).includes(name))).toBe(true);
  });

  it("escapes coordinates instead of trusting them as raw query text", () => {
    const path = connectionAddressPath({ provider: "google-search-console", user: "a b", connection: "x&y=z" });
    expect(new URLSearchParams(path.split("?")[1]).get("user")).toBe("a b");
    expect(new URLSearchParams(path.split("?")[1]).get("connection")).toBe("x&y=z");
  });

  it("round-trips through the route parser", () => {
    const path = connectionAddressPath(sample);
    expect(connectionAddressFrom(new URLSearchParams(path.split("?")[1]))).toEqual(sample);
  });

  // A half-specified address must not fall back to someone else's account: selection
  // resolves an owner before it resolves a connection.
  it("drops missing coordinates rather than defaulting them", () => {
    expect(connectionAddressFrom(new URLSearchParams("provider=github"))).toEqual({ provider: "github" });
    expect(connectionAddressFrom(new URLSearchParams("user="))).toEqual({});
  });

  it("keeps the visible label short while the copied value stays absolute", () => {
    expect(connectionAddressLabel(sample)).toBe("github / studio / delivery");
  });
});
