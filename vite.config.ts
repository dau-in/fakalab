import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    /**
     * Vite preloads a lazy chunk's dependencies from the entry HTML, which
     * would pull the whole 3D stack down before anything has painted and undo
     * the split. Everything else still gets preloaded.
     */
    modulePreload: {
      resolveDependencies: (_file, deps) => deps.filter((dep) => !dep.includes("three-")),
    },
    rollupOptions: {
      output: {
        /**
         * three.js and its React bindings are most of the weight here, and
         * nothing on screen needs them until the viewport mounts. Splitting
         * them out lets the interface paint while they arrive.
         */
        manualChunks(id) {
          if (id.includes("node_modules/three") || id.includes("@react-three")) return "three";
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) {
            return "react";
          }
          return undefined;
        },
      },
    },
  },
});
