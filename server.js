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
const { createFtpClient } = require("./lib/services/ftp");
const { handleApiHealth } = require("./lib/health");
const { parseUsageCsv } = require("./lib/parsers/appUsage");

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

function logEvent(message, extra = "") {
  const stamp = new Date().toISOString();
  const suffix = extra ? ` ${extra}` : "";
  console.log(`[${stamp}] ${message}${suffix}`);
}

function parseBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  return fallback;
}

function formatLocalIsoDate(date) {
  const pad = (num) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function shiftDays(date, days) {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + days);
  return shifted;
}

function parseUsageDateToIso(value) {
  if (!value) return null;
  const normalized = String(value).trim();
  const slashMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (slashMatch) {
    const month = Number.parseInt(slashMatch[1], 10);
    const day = Number.parseInt(slashMatch[2], 10);
    const rawYear = Number.parseInt(slashMatch[3], 10);
    const year = slashMatch[3].length === 2 ? (2000 + rawYear) : rawYear;
    if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return formatLocalIsoDate(parsed);
}

function isFreshFtpPhoneUsage(payload, now = new Date()) {
  if (!payload || payload.source !== "ftp") return false;
  const expectedDirectory = formatLocalIsoDate(now);
  if (payload.directory !== expectedDirectory) return false;

  const usageDateIso = parseUsageDateToIso(payload?.daily?.date);
  if (!usageDateIso) return false;
  const expectedUsageDate = formatLocalIsoDate(shiftDays(now, -1));
  return usageDateIso === expectedUsageDate;
}

function isUpdatedToday(value, now = new Date()) {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  return formatLocalIsoDate(parsed) === formatLocalIsoDate(now);
}

const ftpClient = createFtpClient({
  config: {
    host: process.env.FTP_HOST || "",
    port: process.env.FTP_PORT || "",
    user: process.env.FTP_USER || "",
    password: process.env.FTP_PASSWORD || "",
    path: process.env.FTP_PATH || "/",
    passive: parseBoolean(process.env.FTP_PASSIVE, true),
  },
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
  let ftpPayload = null;
  if (ftpClient.isConfigured()) {
    const cached = readJson(paths.gmail.phoneUsagePath);
    if (isFreshFtpPhoneUsage(cached)) {
      logEvent("FTP phone usage: using cached file", `file=${cached.file || "unknown"}`);
      sendJson(res, 200, cached);
      return;
    }

    try {
      logEvent("FTP phone usage: checking latest CSV");
      const latest = await ftpClient.fetchLatestUsageCsv();
      if (latest?.text) {
        const parsed = parseUsageCsv(latest.text);
        if (parsed?.daily) {
          ftpPayload = {
            ...parsed,
            source: "ftp",
            directory: latest.directory,
            file: latest.file,
            path: latest.path,
            updated_at: new Date().toISOString(),
          };
          logEvent("FTP phone usage: parsed", `file=${latest.file}`);
        }
      }
    } catch (error) {
      logEvent("FTP phone usage failed", `error=${error?.message || error}`);
      ftpPayload = null;
    }
  }

  if (ftpPayload) {
    writeJson(paths.gmail.phoneUsagePath, ftpPayload);
    sendJson(res, 200, ftpPayload);
    return;
  }

  const token = await gmailClient.getAccessToken();
  if (!token) {
    logEvent("Gmail phone usage: not connected");
    sendJson(res, 401, { error: "Gmail not connected." });
    return;
  }

  try {
    const parsed = await gmailClient.fetchLatestUsageEmail();
    if (!parsed) {
      logEvent("Gmail phone usage: no email found");
      sendJson(res, 404, { error: "No app usage email found." });
      return;
    }
    const payload = { ...parsed, source: "gmail" };
    writeJson(paths.gmail.phoneUsagePath, payload);
    sendJson(res, 200, payload);
    logEvent("Gmail phone usage: fetched");
  } catch (error) {
    logEvent("Gmail phone usage failed", `error=${error?.message || error}`);
    sendJson(res, 500, { error: error?.message || "Failed to read Gmail." });
  }
}

async function handleApiHabits(res) {
  if (!process.env.HABITIFY_API_KEY) {
    logEvent("Habitify: missing API key");
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
    logEvent("Habitify: fetched", `date=${targetDate}`);
  } catch (error) {
    logEvent("Habitify failed", `error=${error?.message || error}`);
    sendJson(res, 500, { error: error?.message || "Failed to load habits." });
  }
}

async function handleApiFtp(res) {
  if (!ftpClient.isConfigured()) {
    logEvent("FTP list: not configured");
    sendJson(res, 500, { error: "FTP not configured." });
    return;
  }

  const cached = readJson(paths.ftp.filesPath);
  if (cached?.path && Array.isArray(cached?.files) && isUpdatedToday(cached.updated_at)) {
    logEvent("FTP list: using cached");
    sendJson(res, 200, cached);
    return;
  }

  try {
    const files = await ftpClient.listFiles();
    const payload = {
      updated_at: new Date().toISOString(),
      path: ftpClient.config.path || "/",
      files,
    };
    writeJson(paths.ftp.filesPath, payload);
    sendJson(res, 200, payload);
    logEvent("FTP list: fetched", `count=${files.length}`);
  } catch (error) {
    logEvent("FTP list failed", `error=${error?.message || error}`);
    sendJson(res, 500, { error: error?.message || "Failed to list FTP files." });
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
      logEvent("WHOOP health: fetched", `source=${parsed.query?.source || "unknown"}`);
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

    if (pathname === "/api/ftp/status") {
      sendJson(res, 200, { configured: ftpClient.isConfigured() });
      return;
    }

    if (pathname === "/api/ftp") {
      await handleApiFtp(res);
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
