import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * Flat ESLint config.
 *
 * Three things about this file are worth knowing, because each is a workaround
 * for a specific mismatch rather than a preference:
 *
 * 1. **`FlatCompat` is required, not decorative.** `eslint-config-next@15.5.26`
 *    still ships its presets in the *legacy* eslintrc format —
 *    `module.exports = { extends: [...] }` — so they cannot be spread into a flat
 *    config array. `FlatCompat` reads a legacy config and emits the flat objects
 *    ESLint 9 expects. It is the officially documented bridge, and it is the
 *    only way to keep Next's own rule set instead of reimplementing it from
 *    memory.
 *
 * 2. **`extends` inside a config object is unavailable.** The `extends` key in a
 *    flat config object is a later-9.x feature; the installed ESLint is 9.21.
 *    Every composition below is therefore an explicit array spread rather than a
 *    nested `extends`, which is the same thing spelled for a version that
 *    predates the shorthand.
 *
 * 3. **The TypeScript layer is separate from the Next layer.** The Next
 *    TypeScript preset sets a *parser*; it does not enable TypeScript's rules. So
 *    without `tseslint.configs.recommended` layered on after it, every `.ts` file
 *    is parsed correctly and almost nothing is checked — the worst of both
 *    worlds, because a build that reports "linted clean" has linted nothing.
 */

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

const TS_FILES = ["**/*.{ts,tsx,mts,cts}"];

/** Re-scope a preset's config objects to a set of globs. */
function scoped(configs, files) {
  return configs.map((config) => ({ ...config, files }));
}

const config = [
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      // Rewritten by the framework on every build; not ours to lint.
      "next-env.d.ts",
      "node_modules/**",
      // The seed script runs outside the app. It is type-checked by
      // `tsc --noEmit` like everything else, and it deliberately imports a
      // `node:crypto` module the app's ESLint environment does not model.
      "prisma/seed.ts",
    ],
  },

  // Next's own rules: core-web-vitals plus the framework's React presets.
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // TypeScript's own rules, on top of the parser the preset above installed.
  ...scoped(tseslint.configs.recommended, TS_FILES),

  {
    files: TS_FILES,
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // Every API boundary in this project is parsed by Zod and every Prisma
      // result is typed, so an `any` here is always a hole in a check that
      // mattered — never a legitimate escape hatch.
      "@typescript-eslint/no-explicit-any": "error",

      // `_`-prefixed names are the convention for deliberately unused values:
      // unused route-handler arguments, unused catch bindings for swallowed
      // failures. The naming is what makes each one self-documenting.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // An empty block is almost always a swallowed error. `allowEmptyCatch`
      // keeps the several deliberate ones legal; the rest must say why.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },

  {
    // Config files are not application code. The type-aware rules above would
    // try to resolve their imports through the project tsconfig, which does not
    // include them.
    files: ["**/*.config.{js,mjs,ts,cjs}", "eslint.config.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
];

export default config;
