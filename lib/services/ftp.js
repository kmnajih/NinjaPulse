const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

function normalizePath(value, { isDir } = { isDir: true }) {
  if (!value) return "/";
  const cleaned = value.startsWith("/") ? value : `/${value}`;
  if (!isDir) return cleaned.endsWith("/") ? cleaned.slice(0, -1) : cleaned;
  return cleaned.endsWith("/") ? cleaned : `${cleaned}/`;
}

function buildFtpUrl({ host, port, user, password, path }) {
  const safeUser = user ? encodeURIComponent(user) : "";
  const safePass = password ? encodeURIComponent(password) : "";
  const authPart = safeUser
    ? `${safeUser}${safePass ? `:${safePass}` : ""}@`
    : "";
  const portPart = port ? `:${port}` : "";
  const pathPart = normalizePath(path, { isDir: true });
  return `ftp://${authPart}${host}${portPart}${encodeURI(pathPart)}`;
}

function createFtpClient({ config }) {
  const resolvedConfig = {
    host: config.host || "",
    port: config.port || "",
    user: config.user || "",
    password: config.password || "",
    path: config.path || "/",
    passive: config.passive !== false,
  };

  function isConfigured() {
    return Boolean(resolvedConfig.host && resolvedConfig.user);
  }

  function buildUrlForPath(pathOverride, { isDir } = { isDir: true }) {
    const pathValue = pathOverride ?? resolvedConfig.path;
    const safeUser = resolvedConfig.user ? encodeURIComponent(resolvedConfig.user) : "";
    const safePass = resolvedConfig.password ? encodeURIComponent(resolvedConfig.password) : "";
    const authPart = safeUser
      ? `${safeUser}${safePass ? `:${safePass}` : ""}@`
      : "";
    const portPart = resolvedConfig.port ? `:${resolvedConfig.port}` : "";
    const pathPart = normalizePath(pathValue, { isDir });
    return `ftp://${authPart}${resolvedConfig.host}${portPart}${encodeURI(pathPart)}`;
  }

  function buildCurlArgs() {
    const args = [
      "--list-only",
      "--silent",
      "--show-error",
      "--connect-timeout",
      "5",
      "--max-time",
      "12",
    ];

    if (resolvedConfig.passive) {
      args.push("--ftp-pasv");
    } else {
      args.push("--ftp-port", "-");
    }

    return args;
  }

  async function listFiles(pathOverride) {
    if (!isConfigured()) {
      throw new Error("Missing FTP_HOST or FTP_USER.");
    }

    const url = buildUrlForPath(pathOverride, { isDir: true });
    const args = buildCurlArgs();
    args.push(url);

    const { stdout } = await execFileAsync("curl", args, { maxBuffer: 1024 * 1024 });
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async function fetchText(pathOverride) {
    if (!isConfigured()) {
      throw new Error("Missing FTP_HOST or FTP_USER.");
    }

    const url = buildUrlForPath(pathOverride, { isDir: false });
    const args = ["--silent", "--show-error", "--connect-timeout", "5", "--max-time", "20"];
    if (resolvedConfig.passive) {
      args.push("--ftp-pasv");
    } else {
      args.push("--ftp-port", "-");
    }
    args.push(url);
    const { stdout } = await execFileAsync("curl", args, { maxBuffer: 1024 * 1024 * 4 });
    return stdout;
  }

  async function fetchLatestDatedDirectory(basePath) {
    const entries = await listFiles(basePath);
    const dated = entries.filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry));
    if (!dated.length) return null;
    dated.sort();
    return dated[dated.length - 1];
  }

  async function fetchLatestUsageCsv({ basePath = resolvedConfig.path } = {}) {
    const latestDir = await fetchLatestDatedDirectory(basePath);
    if (!latestDir) return null;
    const dirPath = `${normalizePath(basePath, { isDir: true })}${latestDir}/`;
    const files = await listFiles(dirPath);
    if (!files.length) return null;
    const candidates = files.filter((name) => /\.csv$/i.test(name));
    if (!candidates.length) return null;
    const preferred = candidates.filter((name) => /DailyUsage/i.test(name));
    const targetList = preferred.length ? preferred : candidates;
    targetList.sort();
    const fileName = targetList[targetList.length - 1];
    const filePath = `${dirPath}${fileName}`;
    const text = await fetchText(filePath);
    return {
      directory: latestDir,
      file: fileName,
      path: dirPath,
      text,
    };
  }

  return {
    isConfigured,
    listFiles,
    fetchText,
    fetchLatestUsageCsv,
    config: resolvedConfig,
  };
}

module.exports = { createFtpClient };
