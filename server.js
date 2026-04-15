const { start } = require("./src/server/core");

if (require.main === module) {
  start().catch((error) => {
    console.error("Failed to start server.", error);
    process.exit(1);
  });
}

module.exports = {
  start,
};
