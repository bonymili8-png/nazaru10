import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.next/**",
      "**/out/**",
      "**/coverage/**",
      ".claude/**",
      "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports", disallowTypeAnnotations: false },
      ],
      eqeqeq: ["error", "always"],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    // Nest DI reads constructor parameter types at runtime (emitDecoratorMetadata).
    files: ["apps/api/**/*.ts"],
    languageOptions: { parserOptions: { emitDecoratorMetadata: true, experimentalDecorators: true } },
  },
  {
    // Plain Node scripts (no TypeScript types to provide the globals).
    files: ["apps/e2e/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", URL: "readonly", console: "readonly" } },
    rules: { "no-console": "off" },
  },
  {
    files: ["**/scripts/**", "**/*.config.*", "**/migrate*.ts", "**/migrate/**"],
    rules: { "no-console": "off" },
  },
);
