import { fileURLToPath } from "node:url";
import config from "../postcss.config.mjs";

export default {
  ...config,
  plugins: {
    ...config.plugins,
    "@tailwindcss/postcss": {
      ...config.plugins["@tailwindcss/postcss"],
      // Next builds from demo/, while the shell and its classes live at the repo root.
      base: fileURLToPath(new URL("../", import.meta.url)),
    },
  },
};
