const fs = require("fs");
const path = require("path");

function createLogger(baseDir) {
  const logsDir = path.join(baseDir, "data", "logs");
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  function logJson(service, label, payload) {
    const safeLabel = label.replace(/[^a-z0-9-_]/gi, "_").toLowerCase();
    const filename = `${service}__${safeLabel}.json`;
    const filePath = path.join(logsDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  }

  return { logJson };
}

module.exports = { createLogger };
