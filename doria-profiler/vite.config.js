import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    host: true,            // écoute 0.0.0.0 (indispensable pour Docker)
    open: !process.env.DOCKER,
    watch: {
      // polling nécessaire dans Docker pour que Vite détecte les changements de fichiers
      // (sur certains setups Linux/macOS le bind-mount ne propage pas les events fs)
      usePolling: !!process.env.DOCKER,
      interval: 300,
    },
  },
});
