// Shared by the Node CLI and server stores: expand only the documented current
// user's ~ prefix. This does not authorize a path or relax filesystem guards.
const os = require("node:os");
const path = require("node:path");
function expandOwnerStorePath(value) {
  if (typeof value !== "string" || value.includes("\0")) throw new Error("Invalid owner store path");
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}
module.exports = { expandOwnerStorePath };
