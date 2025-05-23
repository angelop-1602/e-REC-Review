module.exports = {
  extends: "next/core-web-vitals",
  ignorePatterns: ["build/*"],
  rules: {
    "@typescript-eslint/no-unused-vars": "warn",
    "react/no-unescaped-entities": "warn",
  },
  overrides: [
    {
      files: ["src/app/reviewer/protocols/[id]/page.tsx"],
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-unused-vars": "off",
        "react/no-unescaped-entities": "off"
      }
    },
    {
      files: ["src/app/reviewer/notices/page.tsx"],
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-unused-vars": "off",
        "react/no-unescaped-entities": "off"
      }
    }
  ]
}; 