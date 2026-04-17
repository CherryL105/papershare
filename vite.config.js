const path = require("path");
const { defineConfig } = require("vite");
const preactModule = require("@preact/preset-vite");
const preact = preactModule.default || preactModule;

module.exports = defineConfig({
  appType: "mpa",
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, "src/client/catalog/index.html"),
        paper: path.resolve(__dirname, "src/client/detail/paper.html"),
      },
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("temml")) {
              return "vendor-temml";
            }
            if (id.includes("preact")) {
              return "vendor-preact";
            }
            // General vendor chunk for other small libraries
            return "vendors";
          }
          
          // Separate shared client code from specific page logic
          if (id.includes("src/client/shared")) {
            return "client-shared";
          }

          if (id.includes("src/client/detail/detail-store")) {
            return "detail-runtime";
          }
        },
      },
    },
  },
  plugins: [preact({ devToolsEnabled: false })],
  server: {
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.PORT || 3000}`,
      },
    },
  },
});
