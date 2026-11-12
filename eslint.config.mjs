import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  { files: ["**/*.{js,mjs,cjs,ts}"] },
  { languageOptions: { globals: globals.browser } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-duplicate-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          "args": "all",
          "argsIgnorePattern": "^_",
          "destructuredArrayIgnorePattern": "^_",
          "varsIgnorePattern": "^_"
        }
      ],
      '@typescript-eslint/naming-convention': [
        'error',
        {
          "selector": "classProperty",
          "modifiers": ["private"],
          "format": null,
          "suffix": ["_"]
        }
      ],
    }
  },
  {
    files: ["eslint.config.mjs"],
    languageOptions: { globals: globals.node }
  },
  {
    files: ["src/**/*.{js,ts}"],
    rules: {
      'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'warn'
    }
  },
  { ignores: ["node_modules", "**/coverage", "**/dist", ".vitepress/cache", "docs/api", "docs/public/examples"] },
];
