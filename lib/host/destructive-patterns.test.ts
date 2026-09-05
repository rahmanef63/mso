import { describe, expect, it } from "vitest";
import { matchDestructive } from "./destructive-patterns";

// Predicate-only fixtures: these strings are never sent to a shell.
describe("matchDestructive", () => {
  it("flags box-wrecking commands", () => {
    expect(matchDestructive("rm -rf /")).toBeTruthy();
    expect(matchDestructive("sudo shutdown now")).toBeTruthy();
    expect(matchDestructive("systemctl stop mso")).toBeTruthy();
    expect(matchDestructive("mkfs.ext4 /dev/sda")).toBeTruthy();
    expect(matchDestructive("kill -9 1")).toBeTruthy();
  });

  it.each([
    'HOME=/ rm -rf "$HOME"',
    'rm -rf "${TARGET}"',
    'rm --recursive --force -- "$TARGET"',
    'rm -R "$1"',
    'rm -fr "${TARGET:-/}"',
    'rm "$TARGET" -rf',
    'rm -rf "$(printf target)"',
    'rm -rf `printf target`',
  ])("refuses unresolved recursive-delete expansion: %s", (command) => {
    expect(matchDestructive(command)).toMatch(/unresolved shell expansion/);
  });

  it("allows ordinary commands and reviewed literal cleanup targets", () => {
    expect(matchDestructive("ls -la ~/projects")).toBeNull();
    expect(matchDestructive("git status")).toBeNull();
    expect(matchDestructive("npm run build")).toBeNull();
    expect(matchDestructive('printf "%s" "$HOME"')).toBeNull();
    // Literal deletion still requires normal human approval. This guard is not
    // a filesystem sandbox or authorization to delete arbitrary owner data.
    expect(matchDestructive("rm -rf ~/projects/scratch")).toBeNull();
    expect(matchDestructive("rm -rf /tmp/mso-owned-fixture")).toBeNull();
  });
});
