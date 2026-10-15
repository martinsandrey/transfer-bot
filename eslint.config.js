import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "saida-reconhecimento/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  { files: ["**/*.ts"], rules: { "no-console": "off" } },
);
