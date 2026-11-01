import { describe, expect, it, vi } from "vitest";

// Contract for writing Convex deployment env vars over HTTP.
//
// Two things here were learned the hard way against a live deployment (laudable-bat-171,
// ap-southeast-2, 2026-11-02) rather than from docs:
//
//  1. A deployment deploy key authenticates `update_environment_variables` directly. Minting an
//     ephemeral key from a personal token, and shelling out to `convex env set`, were both
//     unnecessary — and the CLI path additionally required a project checkout that a credential
//     connection does not have.
//  2. A deployment outside the US needs its region in the host or every call answers 404.

const KEY = "prod:laudable-bat-171|" + "A".repeat(40);

async function seeded(values: Record<string, string> = {}) {
  vi.resetModules();
  const store = await import("./store");
  vi.spyOn(store, "readInfraProvider").mockResolvedValue({
    deployKey: KEY,
    deploymentName: "laudable-bat-171",
    ...values,
  });
  return import("./convex-env-write");
}

function okJson() {
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
}

describe("convex env write", () => {
  it("writes with the deployment key itself, over HTTP, to the region-qualified host", async () => {
    const { setConvexEnv } = await seeded({ deploymentRegion: "ap-southeast-2" });
    const fetchImpl = vi.fn(async () => okJson());

    const result = await setConvexEnv({ name: "AUTH_GOOGLE_ID", value: "s3cret" }, fetchImpl as never);

    expect(result).toEqual({ deploymentName: "laudable-bat-171", name: "AUTH_GOOGLE_ID", set: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    // The region must be in the hostname; without it a non-US deployment answers 404.
    expect(url).toBe("https://laudable-bat-171.ap-southeast-2.convex.cloud/api/v1/update_environment_variables");
    expect((init.headers as Record<string, string>).authorization).toBe(`Convex ${KEY}`);
    expect(JSON.parse(String(init.body))).toEqual({ changes: [{ name: "AUTH_GOOGLE_ID", value: "s3cret" }] });
  });

  it("falls back to the US host when no region is configured", async () => {
    const { setConvexEnv } = await seeded();
    const fetchImpl = vi.fn(async () => okJson());
    await setConvexEnv({ name: "A", value: "b" }, fetchImpl as never);
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0])
      .toBe("https://laudable-bat-171.convex.cloud/api/v1/update_environment_variables");
  });

  it("never returns the value", async () => {
    const { setConvexEnv } = await seeded({ deploymentRegion: "ap-southeast-2" });
    const result = await setConvexEnv({ name: "A", value: "do-not-echo-me" }, (async () => okJson()) as never);
    expect(JSON.stringify(result)).not.toContain("do-not-echo-me");
  });

  it("redacts the value when the server echoes it back in a rejection", async () => {
    // The realistic shape: Convex answers 4xx with a body quoting what it refused.
    const { setConvexEnv } = await seeded({ deploymentRegion: "ap-southeast-2" });
    const fetchImpl = async () =>
      new Response(JSON.stringify({ code: "BadRequest", message: "invalid value s3cret-value" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });

    const error = await setConvexEnv({ name: "A", value: "s3cret-value" }, fetchImpl as never).catch((e) => e);
    expect(error.code).toBe("convex_deployment_http_400");
    // Whatever the shape, the secret must not be reachable from the error.
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain("s3cret-value");
    expect(String(error.detail)).toContain("[REDACTED_VALUE]");
  });

  it("refuses a value over 8 KiB without making a request", async () => {
    const { setConvexEnv } = await seeded({ deploymentRegion: "ap-southeast-2" });
    const fetchImpl = vi.fn(async () => okJson());
    await expect(setConvexEnv({ name: "A", value: "x".repeat(8 * 1024 + 1) }, fetchImpl as never))
      .rejects.toMatchObject({ code: "convex_env_value_too_large" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an invalid name without making a request", async () => {
    const { setConvexEnv } = await seeded({ deploymentRegion: "ap-southeast-2" });
    const fetchImpl = vi.fn(async () => okJson());
    await expect(setConvexEnv({ name: "1BAD NAME", value: "v" }, fetchImpl as never))
      .rejects.toMatchObject({ code: "invalid_convex_env_name" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("names the missing field when the connection has no deployment", async () => {
    vi.resetModules();
    const store = await import("./store");
    vi.spyOn(store, "readInfraProvider").mockResolvedValue({ deployKey: KEY, deploymentName: "" });
    const { setConvexEnv } = await import("./convex-env-write");
    await expect(setConvexEnv({ name: "A", value: "v" }, (async () => okJson()) as never))
      .rejects.toMatchObject({ code: "convex_deployment_name_required", status: 409 });
  });

  it("requires a deploy key", async () => {
    vi.resetModules();
    const store = await import("./store");
    vi.spyOn(store, "readInfraProvider").mockResolvedValue({ deploymentName: "d" });
    const { setConvexEnv } = await import("./convex-env-write");
    await expect(setConvexEnv({ name: "A", value: "v" }, (async () => okJson()) as never))
      .rejects.toMatchObject({ code: "convex_deploy_key_required", status: 409 });
  });

  it("sends a batch as one request", async () => {
    const { setConvexEnvs } = await seeded({ deploymentRegion: "ap-southeast-2" });
    const fetchImpl = vi.fn(async () => okJson());
    const result = await setConvexEnvs(
      { changes: [{ name: "A", value: "1" }, { name: "B", value: "2" }] },
      fetchImpl as never,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.names).toEqual(["A", "B"]);
    expect(JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)))
      .toEqual({ changes: [{ name: "A", value: "1" }, { name: "B", value: "2" }] });
  });

  it("deletes with delete:true and no value, which is the shape the API accepts", async () => {
    const { removeConvexEnvs } = await seeded({ deploymentRegion: "ap-southeast-2" });
    const fetchImpl = vi.fn(async () => okJson());
    await removeConvexEnvs({ names: ["A", "A", "B"] }, fetchImpl as never);
    expect(JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)))
      .toEqual({ changes: [{ name: "A", delete: true }, { name: "B", delete: true }] });
  });

  it("rejects an over-wide batch instead of sending it", async () => {
    const { setConvexEnvs } = await seeded({ deploymentRegion: "ap-southeast-2" });
    const fetchImpl = vi.fn(async () => okJson());
    const changes = Array.from({ length: 33 }, (_, i) => ({ name: `K${i}`, value: "v" }));
    await expect(setConvexEnvs({ changes }, fetchImpl as never))
      .rejects.toMatchObject({ code: "invalid_convex_env_changes" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
