import { fileURLToPath } from "node:url";

export default {
  output: "export",
  images: { unoptimized: true },
  poweredByHeader: false,
  turbopack: { root: fileURLToPath(new URL("../", import.meta.url)) },
};
