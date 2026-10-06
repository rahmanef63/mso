import { describe, expect, it } from "vitest";
import { parseTenantCredential, tenantCredentialFields } from "./credentials";
const stamp = { version: 1, issuer: "issuer-a", subject: "alice", tenantId: "tenant-a", principalId: "person-a", mappingRevision: 7 } as const;
describe("versioned server-owned tenant credential binding", () => {
  it("copies and freezes every binding field without normalization", () => {
    const source = { ...stamp };
    const parsed = parseTenantCredential(source);
    expect(parsed).toEqual(source); expect(parsed).not.toBe(source); expect(Object.isFrozen(parsed)).toBe(true);
    expect(tenantCredentialFields({})).toEqual({});
  });
  it.each([null, [], {}, "alice", { ...stamp, version: 2 }, { ...stamp, issuer: "" },
    { ...stamp, subject: "../alice" }, { ...stamp, tenantId: "" }, { ...stamp, principalId: "" },
    { ...stamp, mappingRevision: 0 }, { ...stamp, mappingRevision: 1.5 },
    { ...stamp, mappingRevision: Number.MAX_SAFE_INTEGER + 1 }, { ...stamp, extra: "forged" }])("rejects malformed binding %j", value => {
    expect(() => parseTenantCredential(value)).toThrow();
  });
  it.each(["alice", null, "", 0])("does not upgrade deprecated subject-only marker %j", tenantSubject => {
    expect(() => tenantCredentialFields({ tenantSubject })).toThrow("unversioned");
    expect(() => tenantCredentialFields({ tenantSubject, tenantBinding: stamp })).toThrow("unversioned");
  });
  it.each([null, [], {}, { ...stamp, version: 9 }])("never erases a malformed tenant marker %j", tenantBinding => {
    expect(() => tenantCredentialFields({ tenantBinding })).toThrow();
  });
});
