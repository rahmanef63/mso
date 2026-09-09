import { execFileSync } from "node:child_process";

// Keep operator-instance identities out of the portable/public repository. Build
// these strings from fragments so the guard does not exempt itself by accident.
const forbidden = [
  ["mso", "rahmanef", "com"].join("."),
  ["mso-ui", "rahmanef", "com"].join("."),
  ["game", "rahmanef", "com"].join("."),
  ["", "home", "rahman"].join("/"),
];
const candidates = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\n").filter(Boolean)
  .filter((file) => !file.startsWith("coverage/") && !file.startsWith(".next/"));
const hits = [];
for (const file of candidates) {
  let text;
  try { text = await Bun.file(file).text(); } catch { continue; }
  const literals = /^(app|lib|frontend|components)\//.test(file) && !file.includes(".test.") ? [...forbidden, ["rahmanef", "com"].join(".")] : forbidden;
  for (const literal of literals) if (text.toLowerCase().includes(literal.toLowerCase())) hits.push(`${file}: ${literal}`);
}
if (hits.length) {
  console.error("Forbidden operator-instance literals in portable/public source:\n" + hits.join("\n"));
  process.exit(1);
}
console.log(`instance literal guard passed (${candidates.length} files scanned)`);
