// ESLint 9 flat config for MSO TypeScript/JavaScript backend & scripts (zero Next/React).
import tseslint from "typescript-eslint";

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      ".claude/worktrees/**",
      ".worktrees/**",
      "**/.worktrees/**",
      "frontend/svelte/**",
      "rust-shell/**",
      "os-browser/**",
      "public/**",
      "coverage/**",
      "dist/**",
    ],
  },
  {
    files: ["**/*.{ts,mts,cts,js,mjs,cjs}"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "max-lines": ["warn", { max: 220, skipBlankLines: true, skipComments: true }],
      "no-debugger": "error",
      "no-dupe-keys": "error",
      "no-duplicate-case": "error",
      "no-unreachable": "error",
      "use-isnan": "error",
      "valid-typeof": "error",
    },
  },
];

export default config;
