import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const rootDirectory = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4174",
      },
    },
  },
  build: {
    outDir: "dist",
  },
  resolve: {
    alias: {
      "@": resolve(rootDirectory, "src"),
    },
  },
})
