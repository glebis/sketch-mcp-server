import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const target = process.env.VITE_TARGET || "editor";

const inputMap: Record<string, string> = {
  editor: "src/editor/index.html",
  mobile: "src/mobile/index.html",
};

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: "esnext",
    rollupOptions: {
      input: inputMap[target],
    },
    outDir: "dist",
    emptyOutDir: false,
  },
});
