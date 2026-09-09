import { extOf } from "./util";

// Builds the srcDoc for the live preview. It runs inside a SANDBOXED iframe
// (allow-scripts, NO allow-same-origin → opaque origin: no parent cookies/DOM,
// no authed /api/v1 reach — see preview-pane.tsx). Bare imports resolve from
// esm.sh via an import map; JSX/TS transpile in-browser with Babel standalone.
// No install, no node_modules — "cdn code" the user asked for.

const ESM = "https://esm.sh/";
// Pinned so the harness is reproducible; esm.sh serves it as ESM (default export
// = the Babel object). Fetched once, then HTTP-cached inside the iframe.
const BABEL = `${ESM}@babel/standalone@7.26.4`;

const PREVIEWABLE = new Set([
  "html", "htm", "js", "jsx", "mjs", "cjs", "ts", "tsx", "mts", "css", "md", "markdown",
]);

export function isPreviewable(path: string): boolean {
  return PREVIEWABLE.has(extOf(path));
}

// Pull bare import specifiers (not relative, not a URL) so each maps to esm.sh;
// the browser then resolves the whole transitive graph from the CDN.
const IMPORT_RE =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function bareSpecifiers(code: string): string[] {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(code))) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (!spec) continue;
    if (/^[./]/.test(spec) || /^[a-z][a-z0-9+.-]*:/i.test(spec)) continue; // relative / URL / blob / data
    out.add(spec);
  }
  return [...out];
}

function importMap(code: string, jsx: boolean): string {
  const imports: Record<string, string> = {};
  for (const s of bareSpecifiers(code)) imports[s] = ESM + s;
  // The automatic JSX runtime injects imports the user never wrote — map them too.
  if (jsx) {
    for (const s of ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"]) {
      imports[s] ??= ESM + s;
    }
  }
  return Object.keys(imports).length
    ? `<script type="importmap">${JSON.stringify({ imports })}</script>`
    : "";
}

// Safe-embed source as a JS string literal inside a <script>: JSON-encode, then
// neutralise any "</script" / "<!--" the HTML parser would otherwise act on.
function jsLiteral(code: string): string {
  return JSON.stringify(code).replace(/\x3c\/(script)/gi, "<\\/$1").replace(/\x3c!--/g, "<\\!--");
}

const SHELL_CSS =
  "html,body{margin:0}body{font-family:system-ui,-apple-system,sans-serif;padding:1rem;color:#111;background:#fff;line-height:1.5}" +
  "#__err{position:fixed;inset:auto 0 0 0;max-height:45%;overflow:auto;margin:0;padding:10px 12px;" +
  "font:12px/1.45 ui-monospace,monospace;color:#fff;background:#b00020;white-space:pre-wrap;display:none}";

function docShell(head: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${SHELL_CSS}</style>${head}</head><body>${body}</body></html>`;
}

// Classic (sync) script — defines window.__err before the deferred module runs.
const ERR_RUNTIME =
  `<pre id="__err"></pre><script>(function(){var e=document.getElementById('__err');` +
  `function show(m){e.style.display='block';e.textContent=String(m)}` +
  `window.addEventListener('error',function(ev){show(ev.message+(ev.filename?'\\n'+ev.filename+':'+ev.lineno:''))});` +
  `window.addEventListener('unhandledrejection',function(ev){show(ev.reason&&ev.reason.stack||ev.reason)});` +
  `window.__err=show})()<\/script>`;

export function buildPreview(path: string, code: string): string {
  const ext = extOf(path);
  if (ext === "html" || ext === "htm") return code; // already a full document

  if (ext === "css") {
    return docShell(
      `<style>${code}</style>`,
      `<h1>CSS preview</h1><p>The stylesheet above is applied to this sample page.</p>` +
        `<button>Button</button> <a href="#">Link</a><ul><li>Item one</li><li>Item two</li></ul>`,
    );
  }

  if (ext === "md" || ext === "markdown") {
    const runner =
      `<div id="root"></div><script type="module">import {marked} from "${ESM}marked";` +
      `try{document.getElementById('root').innerHTML=marked.parse(${jsLiteral(code)})}catch(e){window.__err(e)}<\/script>`;
    return docShell("", `${ERR_RUNTIME}${runner}`);
  }

  // js / ts / jsx / tsx / mjs / cjs / mts → transpile, then run as a module.
  const jsx = ext === "jsx" || ext === "tsx";
  const runner =
    `<div id="root"></div>` +
    `<script type="module">import Babel from "${BABEL}";try{` +
    `var out=Babel.transform(${jsLiteral(code)},{presets:[["react",{runtime:"automatic"}],"typescript"],filename:${jsLiteral("file." + ext)}}).code;` +
    `await import(URL.createObjectURL(new Blob([out],{type:"text/javascript"})));` +
    `}catch(e){window.__err(e&&e.stack||e)}<\/script>`;
  return docShell(importMap(code, jsx), `${ERR_RUNTIME}${runner}`);
}
