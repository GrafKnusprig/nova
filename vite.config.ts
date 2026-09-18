import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  publicDir: "images",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: { input: { index: resolve(__dirname, "index.html"), popout: resolve(__dirname, "popout.html"), splash: resolve(__dirname, "splash.html"), about: resolve(__dirname, "about.html") } },
  },
});
