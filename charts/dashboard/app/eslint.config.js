import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config({ ignores: ["types/"] }, js.configs.recommended, tseslint.configs.recommended, {
  // The page's scripts run in the browser, with marked and DOMPurify loaded from a CDN.
  files: ["web/*.js"],
  languageOptions: {
    sourceType: "script",
    globals: { ...globals.browser, marked: "readonly", DOMPurify: "readonly" },
  },
});
