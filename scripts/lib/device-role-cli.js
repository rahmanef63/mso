"use strict";

const DEVICE_ROLES = new Set(["viewer", "operator", "owner"]);

function roleOf(entry) {
  if (!entry || typeof entry !== "object") return "viewer";
  if (entry.role === undefined) return "owner"; // legacy approved device
  return DEVICE_ROLES.has(entry.role) ? entry.role : "viewer";
}

function normalizeApproved(raw) {
  const approved = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  for (const entry of Object.values(approved)) {
    if (entry && typeof entry === "object") entry.role = roleOf(entry);
  }
  return approved;
}

function parseApprovalArgs(args) {
  const id = args[0];
  let role = "owner";
  const labelParts = [];
  for (let index = 1; index < args.length; index += 1) {
    if (args[index] === "--role") {
      role = args[index + 1] || "";
      index += 1;
    } else labelParts.push(args[index]);
  }
  return { id, role, label: labelParts.join(" ") || "seeded device" };
}

function setRoleResult({ args, deviceIdRe, withMutation, read, write }) {
  const id = args[1];
  const role = args[2];
  if (!id || !deviceIdRe.test(id) || !DEVICE_ROLES.has(role)) {
    return { code: 1, error: true, lines: ["usage: --set-role <deviceId> <viewer|operator|owner>"] };
  }
  const result = withMutation(() => {
    const store = read();
    const entry = store.approved[id];
    if (!entry) return null;
    const owners = Object.values(store.approved).filter((device) => roleOf(device) === "owner").length;
    if (roleOf(entry) === "owner" && role !== "owner" && owners <= 1) {
      throw new Error("at least one owner device must remain approved");
    }
    entry.role = role;
    write(store);
    return { label: entry.label, role };
  });
  return result
    ? { code: 0, error: false, lines: [`updated ${id}  "${result.label}"  role=${result.role}`] }
    : { code: 1, error: true, lines: [`not approved: ${id}`] };
}

module.exports = { DEVICE_ROLES, normalizeApproved, parseApprovalArgs, roleOf, setRoleResult };
