import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import { localReadProxy } from "./tooling/backend-proxy.mjs";

export default defineConfig(() => {
  const proxy = localReadProxy(process.env.MSO_SVELTE_API_ORIGIN);
  return {
    plugins: [sveltekit({
      adapter: adapter({ pages: "build", assets: "build", fallback: "index.html" }),
      preprocess: vitePreprocess(),
    })],
    server: { host: "127.0.0.1", port: 5173, strictPort: true, proxy },
    preview: { host: "127.0.0.1", port: 4173, strictPort: true, proxy },
  };
});
