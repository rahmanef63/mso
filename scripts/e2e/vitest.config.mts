import base from "../../vitest.config.mts";
const config = { ...base, test: { ...base.test, include: ["scripts/e2e/smoke.production.ts"] } };
export default config;
