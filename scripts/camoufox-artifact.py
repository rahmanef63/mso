#!/usr/bin/env python3
"""Install and verify the reviewed Camoufox release, including its loaded libraries."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import stat
import sys
import tempfile
import urllib.request
import zipfile


def digest(stream):
    value = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        value.update(chunk)
    return value.hexdigest()


def private_path(target, home, create=False):
    relative = target.relative_to(home)
    item = home
    for part in [None, *relative.parts]:
        if part is not None:
            item = item / part
        if create and not item.exists() and not item.is_symlink():
            item.mkdir(mode=0o700)
        info = item.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o022:
            raise ValueError("Camoufox directory is not privately owned or is a symlink")
    if target.stat().st_mode & 0o077:
        raise ValueError("Camoufox installation directory must be private")


def tree_digest(root):
    entries = []
    for item in sorted(root.rglob("*")):
        info = item.lstat()
        if info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError("Camoufox artifact ownership or permissions changed")
        name = item.relative_to(root).as_posix()
        if stat.S_ISDIR(info.st_mode):
            entries.append([name, "dir"])
        elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
            with item.open("rb") as stream:
                entries.append([name, "file", bool(info.st_mode & 0o100), digest(stream)])
        else:
            raise ValueError("Camoufox artifact must contain only regular files and directories")
    return hashlib.sha256(json.dumps(entries, separators=(",", ":")).encode()).hexdigest()


def verify(root, home, expected):
    private_path(root, home)
    if tree_digest(root) != expected:
        raise ValueError("Camoufox installation does not match the reviewed release")
    browser = root / "camoufox"
    if not browser.stat().st_mode & 0o100:
        raise ValueError("Camoufox browser is not executable")
    return browser


def archive_entries(archive):
    entries = archive.infolist()
    names = set()
    for entry in entries:
        name = PurePosixPath(entry.filename)
        mode = entry.external_attr >> 16
        if (name.is_absolute() or ".." in name.parts or "\\" in entry.filename or
                not name.parts or str(name) in names or
                not (stat.S_ISREG(mode) or stat.S_ISDIR(mode))):
            raise ValueError("Unsafe Camoufox archive entry")
        names.add(str(name))
    return entries


def install(root, home, pin):
    private_path(root.parent, home, create=True)
    if root.exists() or root.is_symlink():
        return verify(root, home, pin["treeSha256"])
    cache = home / ".mso/private/camoufox-artifacts"
    private_path(cache, home, create=True)
    archive_path = cache / pin["filename"]
    if not archive_path.exists():
        fd, temporary = tempfile.mkstemp(prefix="download-", dir=cache)
        try:
            with os.fdopen(fd, "wb") as output, urllib.request.urlopen(pin["url"], timeout=60) as response:
                shutil.copyfileobj(response, output)
            os.rename(temporary, archive_path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    info = archive_path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_nlink != 1:
        raise ValueError("Unsafe Camoufox archive file")
    with archive_path.open("rb") as stream:
        if digest(stream) != pin["archiveSha256"]:
            raise ValueError("Camoufox archive checksum does not match the reviewed release")
    stage = Path(tempfile.mkdtemp(prefix="install-", dir=root.parent))
    try:
        with zipfile.ZipFile(archive_path) as archive:
            for entry in archive_entries(archive):
                target = stage / entry.filename
                if entry.is_dir():
                    target.mkdir(parents=True, exist_ok=True, mode=0o700)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    with archive.open(entry) as source, target.open("xb") as output:
                        shutil.copyfileobj(source, output)
                    target.chmod(0o700 if entry.external_attr >> 16 & 0o111 else 0o600)
        verify(stage, home, pin["treeSha256"])
        os.rename(stage, root)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return verify(root, home, pin["treeSha256"])


def main():
    if sys.argv[1:] not in (["install"], ["verify"]):
        raise ValueError("Usage: camoufox-artifact.py install|verify")
    if sys.platform != "linux":
        raise ValueError("Reviewed Camoufox artifacts require Linux")
    pins = json.loads(Path(__file__).with_name("camoufox-artifact.json").read_text())
    arch = {"aarch64": "arm64", "x86_64": "x86_64"}.get(platform.machine())
    if arch not in pins["linux"]:
        raise ValueError("No reviewed Camoufox artifact for this architecture")
    home = Path.home()
    root = home / ".mso/private/camoufox" / (pins["version"] + "-" + arch)
    if os.environ.get("CAMOUFOX_BROWSER") not in (None, "", str(root / "camoufox")):
        raise ValueError("CAMOUFOX_BROWSER must name the reviewed installation; arbitrary cache executables are refused")
    pin = pins["linux"][arch]
    browser = install(root, home, pin) if sys.argv[1] == "install" else verify(root, home, pin["treeSha256"])
    print(browser)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, zipfile.BadZipFile) as error:
        print("camoufox-artifact: " + str(error), file=sys.stderr)
        sys.exit(1)
