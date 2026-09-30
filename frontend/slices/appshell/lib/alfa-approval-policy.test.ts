import { beforeEach, expect, it } from "vitest";
import { alfaApprovalKey, alfaApprovalScope, canRememberAlfaTool, hasAlfaApproval, newAlfaApprovalSession, rememberAlfaApproval, resetAlfaApprovalPolicy, revokeAlfaApproval } from "./alfa-approval-policy";
beforeEach(resetAlfaApprovalPolicy);
it("requires exact nested arguments, tool, project and mode", () => {
  const scope = alfaApprovalScope("/project", "live");
  const args = { path: "/project/note.txt", content: "hello", metadata: { a: 1 } };
  rememberAlfaApproval("fs.write", args, scope);
  expect(hasAlfaApproval("fs.write", { metadata: { a: 1 }, content: "hello", path: args.path }, scope)).toBe(true);
  for (const input of [{ ...args, content: "changed" }, { ...args, metadata: { a: 2 } }])
    expect(hasAlfaApproval("fs.write", input, scope)).toBe(false);
  expect(hasAlfaApproval("fs.mkdir", args, scope)).toBe(false);
  expect(hasAlfaApproval("fs.write", args, alfaApprovalScope("/other", "live"))).toBe(false);
  expect(hasAlfaApproval("fs.write", args, alfaApprovalScope("/project", "mock"))).toBe(false);
});
it("refuses destructive, credential, system and traversal operations", () => {
  for (const tool of ["exec.run", "fs.delete", "fs.move", "config.set", "unknown"])
    expect(canRememberAlfaTool(tool, { path: "/project/note.txt" })).toBe(false);
  for (const path of ["/etc/file", "/project/../secret", "/project/.env.local", "~/.ssh/config", "/project/credentials.json", "/project/.mso/state"])
    expect(canRememberAlfaTool("fs.write", { path })).toBe(false);
});
it("supports revoke/reset and prevents grants crossing loaded/new conversations", () => {
  const scope = alfaApprovalScope("/project", "live"), args = { path: "/project/folder" };
  rememberAlfaApproval("fs.mkdir", args, scope);
  revokeAlfaApproval(alfaApprovalKey("fs.mkdir", args, scope));
  expect(hasAlfaApproval("fs.mkdir", args, scope)).toBe(false);
  rememberAlfaApproval("fs.mkdir", args, scope);
  newAlfaApprovalSession();
  expect(hasAlfaApproval("fs.mkdir", args, scope)).toBe(false);
  expect(alfaApprovalScope("/project", "live")).not.toBe(scope);
});
