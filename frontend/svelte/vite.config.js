import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { sveltekit } from "@sveltejs/kit/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { localReadProxy } from "./tooling/backend-proxy.mjs";
import { msoPublicAssetsPlugin, resolveBuildSha, syncPublicAssets } from "./tooling/public-assets.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const PUBLIC_DIR = path.join(REPO_ROOT, "public");
const BUILD_DIR = path.join(HERE, "build");

function createMsoStaticAdapter(meta) {
  const inner = adapter({ pages: "build", assets: "build", fallback: "index.html" });
  return {
    ...inner,
    name: "mso-adapter-static",
    async adapt(builder) {
      await inner.adapt(builder);
      syncPublicAssets(PUBLIC_DIR, BUILD_DIR, meta);
    },
  };
}

export default defineConfig(({ mode }) => {
  const proxy = localReadProxy(process.env.MSO_SVELTE_API_ORIGIN);
  const buildSha = resolveBuildSha(REPO_ROOT);
  const buildMode = process.env.MSO_DEMO_MODE === "1" ? "demo" : mode;
  return {
    define: {
      __MSO_BUILD_SHA__: JSON.stringify(buildSha),
      __MSO_BUILD_MODE__: JSON.stringify(buildMode),
    },
    plugins: [
      sveltekit({
        adapter: createMsoStaticAdapter({ sha: buildSha, mode: buildMode }),
        preprocess: vitePreprocess(),
      }),
      msoPublicAssetsPlugin({
        publicDir: PUBLIC_DIR,
        buildDir: BUILD_DIR,
        repoRoot: REPO_ROOT,
        buildSha,
        buildMode,
      }),
    ],
    server: { host: "127.0.0.1", port: 5173, strictPort: true, proxy },
    preview: { host: "127.0.0.1", port: 4173, strictPort: true, proxy },
  };
});
