import eslint from "@eslint/js";
import tsparser from "@typescript-eslint/parser";
import tsplugin from "@typescript-eslint/eslint-plugin";
import prettier from "eslint-config-prettier";

export default [
  eslint.configs.recommended,
  prettier,
  {
    files: ["src/**/*.ts", "tests/**/*.ts", "scripts/**/*.ts", "bin/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tsplugin,
    },
    rules: {
      ...tsplugin.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "off",
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-redeclare": "off",
      "no-useless-escape": "warn",
      "no-constant-condition": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
    },
  },
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "*.js",
      "*.cjs",
      "*.mjs",
      "!eslint.config.js",
    ],
  },
];
