import config from "../postcss.config.mjs";

export default {
  ...config,
  plugins: {
    ...config.plugins,
    "@tailwindcss/postcss": {
      ...config.plugins["@tailwindcss/postcss"],
      base: process.env.MSO_DEMO_SOURCE_ROOT,
    },
  },
};
