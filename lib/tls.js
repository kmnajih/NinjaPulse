const fs = require("fs");

function loadExtraCa() {
  const certPath = process.env.NODE_EXTRA_CA_CERTS;
  if (!certPath) return null;
  try {
    return fs.readFileSync(certPath, "utf8");
  } catch (error) {
    console.error("Failed to read NODE_EXTRA_CA_CERTS:", error?.message || error);
    return null;
  }
}

module.exports = { loadExtraCa };
