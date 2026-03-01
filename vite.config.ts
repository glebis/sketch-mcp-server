import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: "esnext",
    rollupOptions: {
      input: "src/editor/index.html",
    },
    outDir: "dist",
    emptyOutDir: false,
  },
});
