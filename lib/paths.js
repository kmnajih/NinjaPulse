const path = require("path");

function buildPaths(baseDir) {
  const dataDir = path.join(baseDir, "data");
  return {
    baseDir,
    dataDir,
    whoop: {
      tokenPath: path.join(dataDir, "tokens.json"),
      statePath: path.join(dataDir, "oauth-state.json"),
      healthPath: path.join(dataDir, "health.json"),
    },
    gmail: {
      tokenPath: path.join(dataDir, "gmail-tokens.json"),
      statePath: path.join(dataDir, "gmail-oauth-state.json"),
      phoneUsagePath: path.join(dataDir, "phone-usage.json"),
    },
  };
}

module.exports = { buildPaths };
