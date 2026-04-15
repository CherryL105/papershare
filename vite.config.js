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
