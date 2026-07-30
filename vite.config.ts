/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import webExtension from "vite-plugin-web-extension";

export default defineConfig({
  base: './',
  plugins: [
    react(),
    webExtension({
      manifest: "manifest.json",
    }),
  ],
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["src/test/setup.ts"],
  },
});
