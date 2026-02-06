const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const crypto = require("crypto");

const { loadEnv } = require("./lib/env");
const { buildPaths } = require("./lib/paths");
const { ensureDir, readJson, writeJson } = require("./lib/fs");
const { sendJson, sendFile, createRequestJson } = require("./lib/http");
const { loadExtraCa } = require("./lib/tls");
const { createLogger } = require("./lib/logger");
const { createWhoopClient } = require("./lib/services/whoop");
const { createGmailClient } = require("./lib/services/gmail");
const { createHabitifyClient } = require("./lib/services/habitify");
const { handleApiHealth } = require("./lib/health");

const BASE_DIR = __dirname;
loadEnv(BASE_DIR);

const PORT = process.env.PORT || 8787;
const paths = buildPaths(BASE_DIR);
ensureDir(paths.dataDir);

const tlsCa = loadExtraCa();
const requestJson = createRequestJson(tlsCa);
const logger = createLogger(BASE_DIR);

const whoopConfig = {
  clientId: process.env.WHOOP_CLIENT_ID || "",
  clientSecret: process.env.WHOOP_CLIENT_SECRET || "",
  redirectUri: process.env.WHOOP_REDIRECT_URI || `http://localhost:${PORT}/callback`,
  scopes: process.env.WHOOP_SCOPES ||
    "read:recovery read:cycles read:workout read:sleep read:profile read:body_measurement offline",
};

const gmailConfig = {
  clientId: process.env.GMAIL_CLIENT_ID || "",
  clientSecret: process.env.GMAIL_CLIENT_SECRET || "",
  redirectUri: process.env.GMAIL_REDIRECT_URI || `http://localhost:${PORT}/gmail/callback`,
  scopes: process.env.GMAIL_SCOPES || "https://www.googleapis.com/auth/gmail.readonly",
  subjectQuery: process.env.GMAIL_SUBJECT_QUERY || "subject:\"[App Usage]\" subject:\"Daily usage digest\"",
};

const whoopClient = createWhoopClient({ requestJson, config: whoopConfig, paths, readJson, writeJson, logger });
const gmailClient = createGmailClient({ requestJson, config: gmailConfig, paths, readJson, writeJson, logger });
const habitifyClient = createHabitifyClient({
  requestJson,
  config: { apiKey: process.env.HABITIFY_API_KEY || "" },
  logger,
});

function clearWhoopTokens() {
  if (fs.existsSync(paths.whoop.tokenPath)) fs.unlinkSync(paths.whoop.tokenPath);
}

function clearGmailTokens() {
  if (fs.existsSync(paths.gmail.tokenPath)) fs.unlinkSync(paths.gmail.tokenPath);
}

function setState(filePath, state) {
  writeJson(filePath, { state, created_at: new Date().toISOString() });
}

function clearState(filePath) {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

async function handleApiPhone(res) {
  const token = await gmailClient.getAccessToken();
  if (!token) {
    sendJson(res, 401, { error: "Gmail not connected." });
    return;
  }

  try {
    const parsed = await gmailClient.fetchLatestUsageEmail();
    if (!parsed) {
      sendJson(res, 404, { error: "No app usage email found." });
      return;
    }
    writeJson(paths.gmail.phoneUsagePath, parsed);
    sendJson(res, 200, parsed);
  } catch (error) {
    sendJson(res, 500, { error: error?.message || "Failed to read Gmail." });
  }
}

async function handleApiHabits(res) {
  if (!process.env.HABITIFY_API_KEY) {
    sendJson(res, 500, { error: "Missing HABITIFY_API_KEY" });
    return;
  }

  try {
    const targetDate = formatTargetDate(yesterday());
    const payload = await habitifyClient.getJournal(targetDate);
    const habits = payload?.data || [];
    const simplified = habits.map((entry) => ({
      id: entry.id,
      name: entry.name,
      status: resolveHabitStatus(entry),
    }));
    sendJson(res, 200, { date: targetDate, habits: simplified });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || "Failed to load habits." });
  }
}

function yesterday() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  date.setHours(23, 59, 59, 0);
  return date;
}

function formatTargetDate(date) {
  const pad = (num) => String(num).padStart(2, "0");
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const offsetAbs = Math.abs(offsetMinutes);
  const offsetHours = pad(Math.floor(offsetAbs / 60));
  const offsetMins = pad(offsetAbs % 60);
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetMins}`;
}

function normalizeHabitStatus(status) {
  if (!status) return "not_done";
  if (typeof status === "string") {
    const normalized = status.toLowerCase();
    return normalized === "completed" || normalized === "done" ? "done" : "not_done";
  }
  if (typeof status === "object" && status.status) {
    const normalized = String(status.status).toLowerCase();
    return normalized === "completed" || normalized === "done" ? "done" : "not_done";
  }
  if (typeof status === "object" && status.value) {
    const normalized = String(status.value).toLowerCase();
    return normalized === "completed" || normalized === "done" ? "done" : "not_done";
  }
  return "not_done";
}

function resolveHabitStatus(entry) {
  if (!entry) return "not_done";
  const normalized = normalizeHabitStatus(entry.status);
  if (normalized === "done") return "done";

  const progress = entry.progress;
  if (progress && typeof progress === "object") {
    const current = Number(progress.current_value);
    const target = Number(progress.target_value);
    if (Number.isFinite(current) && Number.isFinite(target) && current >= target) {
      return "done";
    }
  }

  return "not_done";
}

function serveStatic(req, res) {
  const parsed = url.parse(req.url);
  const pathname = parsed.pathname === "/" ? "/index.html" : parsed.pathname;
  const filePath = path.join(BASE_DIR, pathname);

  const contentTypes = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
  };

  const ext = path.extname(filePath);
  const contentType = contentTypes[ext] || "text/plain";

  if (!filePath.startsWith(BASE_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  sendFile(res, filePath, contentType);
}

const server = http.createServer(async (req, res) => {
  try {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;

    if (pathname === "/api/status") {
      const token = await whoopClient.getAccessToken();
      sendJson(res, 200, { connected: Boolean(token) });
      return;
    }

    if (pathname === "/api/health") {
      await handleApiHealth({
        whoopClient,
        paths,
        sendJson: (status, payload) => sendJson(res, status, payload),
      });
      return;
    }

    if (pathname === "/api/phone") {
      await handleApiPhone(res);
      return;
    }

    if (pathname === "/api/habits") {
      await handleApiHabits(res);
      return;
    }

    if (pathname === "/api/gmail/status") {
      const token = await gmailClient.getAccessToken();
      sendJson(res, 200, { connected: Boolean(token) });
      return;
    }

    if (pathname === "/login") {
      if (!whoopConfig.clientId || !whoopConfig.clientSecret) {
        res.writeHead(500);
        res.end("Missing WHOOP_CLIENT_ID or WHOOP_CLIENT_SECRET");
        return;
      }
      const state = crypto.randomBytes(4).toString("hex");
      setState(paths.whoop.statePath, state);
      res.writeHead(302, { Location: whoopClient.buildAuthUrl(state) });
      res.end();
      return;
    }

    if (pathname === "/callback") {
      const { code, state } = parsed.query;
      const storedState = readJson(paths.whoop.statePath)?.state;
      if (!code || !state || state !== storedState) {
        res.writeHead(400);
        res.end("Invalid state or code");
        return;
      }

      clearState(paths.whoop.statePath);
      await whoopClient.exchangeToken(code);
      res.writeHead(302, { Location: "/" });
      res.end();
      return;
    }

    if (pathname === "/gmail/login") {
      if (!gmailConfig.clientId || !gmailConfig.clientSecret) {
        res.writeHead(500);
        res.end("Missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET");
        return;
      }
      const state = crypto.randomBytes(6).toString("hex");
      setState(paths.gmail.statePath, state);
      res.writeHead(302, { Location: gmailClient.buildAuthUrl(state) });
      res.end();
      return;
    }

    if (pathname === "/gmail/callback") {
      const { code, state } = parsed.query;
      const storedState = readJson(paths.gmail.statePath)?.state;
      if (!code || !state || state !== storedState) {
        res.writeHead(400);
        res.end("Invalid state or code");
        return;
      }
      clearState(paths.gmail.statePath);
      await gmailClient.exchangeToken(code);
      res.writeHead(302, { Location: "/" });
      res.end();
      return;
    }

    if (pathname === "/gmail/logout" && req.method === "POST") {
      clearGmailTokens();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === "/logout" && req.method === "POST") {
      clearWhoopTokens();
      sendJson(res, 200, { ok: true });
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    const details = {
      message: error?.message || String(error),
      code: error?.code,
      cause: error?.cause?.message || error?.cause,
    };
    console.error("Server error:", details);
    res.writeHead(500);
    res.end(`Server error: ${details.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`Health dashboard running at http://localhost:${PORT}`);
});
