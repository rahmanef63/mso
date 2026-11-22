// Mock seed "disk" so the editor feels populated before any live FS read.
// SEED_FILES holds the initial contents keyed by absolute path; the live tree
// (components/shared/file-tree) now provides the directory listing via OsApi.

export const SEED_FILES: Record<string, string> = {
  "/readme.md":
    "# Manef Shell OS\n\nA mobile-friendly visual shell for a Linux server you own.\n\n" +
    "- **Files**: manage your storage\n- **Code**: this editor\n" +
    "- **Alfa**: BYOK AI assistance inside the browser workspace\n\n" +
    "Connect a VPS in Settings → Server to go live.\n",
  "/Documents/roadmap.md":
    "# Roadmap\n\n## Now\n- [x] Browser shell\n- [x] Code editor\n\n" +
    "## Next\n- [ ] Live VPS daemon\n- [ ] Collaborative editing\n",
  "/Projects/hello.ts":
    '// hello.ts: sample slice\nimport { greet } from "./greet";\n\n' +
    "type User = { id: number; name: string };\n\n" +
    "export function welcome(user: User): string {\n" +
    "  const msg = greet(user.name); // friendly hello\n" +
    "  return `${msg} (#${user.id})`;\n}\n\n" +
    'welcome({ id: 1, name: "ada" });\n',
  // Self-contained React showcase for the live Preview — deps resolve from
  // esm.sh (no install). Hit "Preview" in the toolbar to run it.
  "/Projects/counter.tsx":
    'import { useState } from "react";\n' +
    'import { createRoot } from "react-dom/client";\n\n' +
    "function Counter() {\n" +
    "  const [n, setN] = useState(0);\n" +
    "  return (\n" +
    '    <div style={{ fontFamily: "system-ui", padding: 24 }}>\n' +
    "      <h1>Hello from esm.sh 👋</h1>\n" +
    "      <p>Imports load straight from the CDN, no install, no node_modules.</p>\n" +
    '      <button onClick={() => setN((c) => c + 1)} style={{ fontSize: 18, padding: "8px 16px" }}>\n' +
    "        Clicked {n} times\n" +
    "      </button>\n" +
    "    </div>\n" +
    "  );\n}\n\n" +
    'createRoot(document.getElementById("root")!).render(<Counter />);\n',
  "/Projects/styles.css":
    "/* card surface */\n.card {\n  background: #1e1e22;\n" +
    "  border-radius: 12px;\n  padding: 16px;\n}\n",
  "/apps/scraper.py":
    "import requests\nfrom bs4 import BeautifulSoup\n\n" +
    "def scrape(url):\n    r = requests.get(url, timeout=10)\n" +
    '    soup = BeautifulSoup(r.text, "html.parser")\n' +
    '    return [a.get("href") for a in soup.find_all("a")]\n\n' +
    'if __name__ == "__main__":\n' +
    '    for link in scrape("https://example.com"):\n        print(link)\n',
  "/apps/backup.sh":
    "#!/usr/bin/env bash\nset -euo pipefail\n\n" +
    'SRC="/Media"\nDEST="/backups/$(date +%F)"\n\n' +
    'mkdir -p "$DEST"\nrsync -a --delete "$SRC/" "$DEST/"\n' +
    'echo "Backup complete -> $DEST"\n',
  "/apps/manifest.json":
    '{\n  "name": "color-picker",\n  "runtime": "html",\n' +
    '  "entry": "index.html",\n  "window": { "width": 360, "height": 480 }\n}\n',
};
