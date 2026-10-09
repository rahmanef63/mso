import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

it("accepts only a complete privately owned reviewed browser tree", () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "mso-camoufox-artifact-"));
  try {
    const fixture = path.join(temporary, "check.py");
    writeFileSync(fixture, `import importlib.util, pathlib, os, stat, zipfile, io
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('artifact', 'scripts/camoufox-artifact.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
home = pathlib.Path(${JSON.stringify(temporary)})
root = home / 'private' / 'version'
m.private_path(root, home, create=True)
browser = root / 'camoufox'; browser.write_text('fixture-browser'); browser.chmod(0o700)
library = root / 'library.so'; library.write_text('fixture-library'); library.chmod(0o600)
expected = m.tree_digest(root)
assert m.verify(root, home, expected) == browser
def refused(action):
    try: action()
    except (ValueError, OSError): return
    raise AssertionError('unsafe artifact accepted')
library.write_text('changed'); refused(lambda: m.verify(root, home, expected)); library.write_text('fixture-library')
library.chmod(0o644); refused(lambda: m.verify(root, home, expected)); library.chmod(0o600)
with patch.object(m.os, 'getuid', return_value=os.getuid() + 1): refused(lambda: m.verify(root, home, expected))
library.unlink(); library.symlink_to(browser); refused(lambda: m.verify(root, home, expected)); library.unlink()
library.write_text('fixture-library'); library.chmod(0o600)
os.link(library, root / 'extra.so'); refused(lambda: m.verify(root, home, expected)); (root / 'extra.so').unlink()
os.mkfifo(root / 'pipe', 0o600); refused(lambda: m.verify(root, home, expected)); (root / 'pipe').unlink()
(root / 'extra').write_text('injected'); (root / 'extra').chmod(0o600); refused(lambda: m.verify(root, home, expected)); (root / 'extra').unlink()
link = home / 'link'; link.symlink_to(root, target_is_directory=True); refused(lambda: m.verify(link, home, expected))
root.chmod(0o777); refused(lambda: m.verify(root, home, expected)); root.chmod(0o700)
outside = home / 'outside'; outside.mkdir(mode=0o700)
refused(lambda: m.verify(outside, home, expected))
for name in ['../escape', '/escape', 'nested\\\\escape']:
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w') as archive:
        info = zipfile.ZipInfo(name); info.external_attr = (stat.S_IFREG | 0o600) << 16; archive.writestr(info, 'fixture')
    stream.seek(0)
    with zipfile.ZipFile(stream) as archive: refused(lambda: m.archive_entries(archive))
assert m.verify(root, home, expected) == browser
print('verified tree and rejected tamper, permissions, owner, symlink, hardlink, FIFO, extra files, path and unsafe ZIP')
`);
    const result = spawnSync("python3", [fixture], { encoding: "utf8", timeout: 20_000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("rejected tamper");
    const launcher = readFileSync("scripts/camoufox-vnc-service", "utf8");
    expect(launcher).toContain('camoufox-artifact.py" verify');
    expect(launcher).not.toContain('find "$HOME/.cache/camoufox');
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
