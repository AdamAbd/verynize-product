import { defineConfig } from "vite-plus";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  publicDir: "web",
  plugins: [cloudflare()],
  lint: {
    ignorePatterns: ["web/dist/**"],
    jsPlugins: ["@shadcn/lint"],
    settings: {
      shadcn: {
        ui: "@/components/ui",
        note: "Tokens live in web/src/styles/globals.css (measured from design/wonder). Add a token there instead of a raw value.",
      },
    },
    overrides: [
      {
        files: ["web/src/**/*.{ts,tsx}"],
        rules: {
          "shadcn/no-raw-colors": "error",
          "shadcn/no-arbitrary-values": "error",
          "shadcn/no-unknown-classes": "error",
          "shadcn/require-static-classes": "error",
          "shadcn/no-inline-styles": "warn",
          "shadcn/no-restyle": ["warn", { allow: ["layout"] }],
          // Shell navigation goes through navigate() so routing rules (cloud fragment, settings
          // history) stay in one module (docs/spikes/tanstack-router.md).
          "no-restricted-imports": [
            "error",
            {
              paths: [
                {
                  name: "@/lib/router/shell-router",
                  importNames: ["shellRouter"],
                  message: "Navigate with navigate() from @/lib/router/shell-router.",
                },
              ],
            },
          ],
        },
      },
      {
        // The router island mounts the router itself.
        files: ["web/src/islands/router.tsx"],
        rules: { "no-restricted-imports": "off" },
      },
      {
        // Vendored shadcn/ui sources are the design system itself.
        files: ["web/src/components/ui/**"],
        rules: {
          "shadcn/no-raw-colors": "off",
          "shadcn/no-arbitrary-values": "off",
          "shadcn/no-unknown-classes": "off",
          "shadcn/no-inline-styles": "off",
          "shadcn/no-restyle": "off",
        },
      },
    ],
  },
});
