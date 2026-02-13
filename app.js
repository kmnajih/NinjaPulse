const statusLine = document.getElementById("statusLine");
const refreshWhoopBtn = document.getElementById("refreshWhoopBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const disconnectGmailBtn = document.getElementById("disconnectGmailBtn");
const refreshGmailBtn = document.getElementById("refreshGmailBtn");
const refreshFtpBtn = document.getElementById("refreshFtpBtn");
const summaryDateEl = document.getElementById("summaryDate");
const statsEl = document.getElementById("stats");
const sleepDetailsPrimaryEl = document.getElementById("sleepDetailsPrimary");
const sleepDetailsSecondaryEl = document.getElementById("sleepDetailsSecondary");
const phoneSummaryEl = document.getElementById("phoneSummary");
const phoneAppsEl = document.getElementById("phoneApps");
const ftpSummaryLineEl = document.getElementById("ftpSummaryLine");
const habitSummaryEl = document.getElementById("habitSummary");
const habitListEl = document.getElementById("habitList");
const whoopStatus = document.getElementById("whoopStatus");
const gmailStatusEl = document.getElementById("gmailStatus");
const ftpStatusEl = document.getElementById("ftpStatus");

const PHONE_APP_MINUTES_THRESHOLD = 30;
const SIMPLE_ICON_BASE = "https://cdn.simpleicons.org";
const FAVICON_BASE = "https://ico.faviconkit.net/favicon";
const APP_ICON_MAP = new Map([
  ["chrome", { slug: "googlechrome", domain: "google.com" }],
  ["google chrome", { slug: "googlechrome", domain: "google.com" }],
  ["google", { slug: "google", domain: "google.com" }],
  ["gmail", { slug: "gmail", domain: "gmail.com" }],
  ["amazon", { slug: "amazon", domain: "amazon.com" }],
  ["amazon shopping", { slug: "amazon", domain: "amazon.com" }],
  ["chatgpt", { slug: "openai", domain: "chatgpt.com" }],
  ["chat gpt", { slug: "openai", domain: "chatgpt.com" }],
  ["youtube", { slug: "youtube", domain: "youtube.com" }],
  ["instagram", { slug: "instagram", domain: "instagram.com" }],
  ["facebook", { slug: "facebook", domain: "facebook.com" }],
  ["messenger", { slug: "messenger", domain: "messenger.com" }],
  ["whatsapp", { slug: "whatsapp", domain: "whatsapp.com" }],
  ["tiktok", { slug: "tiktok", domain: "tiktok.com" }],
  ["snapchat", { slug: "snapchat", domain: "snapchat.com" }],
  ["reddit", { slug: "reddit", domain: "reddit.com" }],
  ["spotify", { slug: "spotify", domain: "spotify.com" }],
  ["linkedin", { slug: "linkedin", domain: "linkedin.com" }],
  ["slack", { slug: "slack", domain: "slack.com" }],
  ["notion", { slug: "notion", domain: "notion.so" }],
  ["discord", { slug: "discord", domain: "discord.com" }],
  ["zoom", { slug: "zoom", domain: "zoom.us" }],
  ["telegram", { slug: "telegram", domain: "telegram.org" }],
  ["signal", { slug: "signal", domain: "signal.org" }],
  ["netflix", { slug: "netflix", domain: "netflix.com" }],
  ["github", { slug: "github", domain: "github.com" }],
  ["x", { slug: "x", domain: "x.com" }],
  ["twitter", { slug: "x", domain: "x.com" }],
]);

refreshWhoopBtn.addEventListener("click", () => loadDashboard());
refreshGmailBtn.addEventListener("click", () => loadPhoneUsage());
refreshFtpBtn.addEventListener("click", () => loadFtpFiles());
disconnectBtn.addEventListener("click", async () => {
  await fetch("/logout", { method: "POST" });
  whoopStatus.textContent = "Not connected";
  statusLine.textContent = "WHOOP disconnected.";
  refreshWhoopBtn.disabled = true;
  disconnectBtn.disabled = true;
  statsEl.innerHTML = "";
  sleepDetailsPrimaryEl.innerHTML = "";
  sleepDetailsSecondaryEl.innerHTML = "";
  phoneSummaryEl.innerHTML = "";
  phoneAppsEl.innerHTML = "";
  habitSummaryEl.innerHTML = "";
  habitListEl.innerHTML = "";
});

disconnectGmailBtn.addEventListener("click", async () => {
  await fetch("/gmail/logout", { method: "POST" });
  disconnectGmailBtn.disabled = true;
  statusLine.textContent = "Gmail disconnected.";
  phoneSummaryEl.innerHTML = "";
  phoneAppsEl.innerHTML = "";
  refreshGmailBtn.disabled = true;
  gmailStatusEl.textContent = "Not connected";
});

async function init() {
  updateSummaryDate();

  const status = await fetchJson("/api/status");
  const gmailStatus = await fetchJson("/api/gmail/status");
  const ftpStatus = await fetchJson("/api/ftp/status");
  if (status?.connected) {
    whoopStatus.textContent = "Connected";
    statusLine.textContent = "Connected. Fetching latest metrics...";
    refreshWhoopBtn.disabled = false;
    disconnectBtn.disabled = false;
    await loadDashboard();
  } else {
    whoopStatus.textContent = "Not connected";
    statusLine.textContent = "Waiting for connection.";
    await loadHabits();
  }

  if (gmailStatus?.connected) {
    disconnectGmailBtn.disabled = false;
    refreshGmailBtn.disabled = false;
    gmailStatusEl.textContent = "Connected";
    await loadPhoneUsage();
  } else {
    gmailStatusEl.textContent = "Not connected";
  }

  if (ftpStatus?.configured) {
    ftpStatusEl.textContent = "Configured";
    refreshFtpBtn.disabled = false;
    await loadFtpFiles();
    if (!gmailStatus?.connected) {
      await loadPhoneUsage();
    }
  } else {
    ftpStatusEl.textContent = "Not configured";
    renderFtpStatus(null);
  }
}

function updateSummaryDate() {
  if (!summaryDateEl) return;
  const now = new Date();
  summaryDateEl.textContent = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function loadDashboard() {
  statusLine.textContent = "Loading WHOOP data...";
  const [health, phone, habits] = await Promise.all([
    fetchJson("/api/health?source=dashboard"),
    fetchJson("/api/phone"),
    fetchJson("/api/habits"),
  ]);
  if (!health) {
    statusLine.textContent = "Unable to load data.";
    return;
  }

  whoopStatus.textContent = "Connected";
  refreshWhoopBtn.disabled = false;
  disconnectBtn.disabled = false;
  statusLine.textContent = `Updated ${new Date(health.generated_at).toLocaleString()}`;

  renderStats(statsEl, buildTopSummary(health.summary, phone, habits));
  renderSleepDetails(health.sleep_details);
  renderPhoneUsageSection(phone);
  renderHabitsSection(habits);
}

async function fetchJson(path) {
  try {
    const response = await fetch(path);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    return null;
  }
}

function renderStats(container, summary) {
  container.innerHTML = "";
  if (!summary?.length) {
    container.innerHTML = "<p class=\"text-sm text-slate-500\">No summary metrics yet.</p>";
    return;
  }

  summary.forEach((item) => {
    container.appendChild(makeStat(item.label, item.value));
  });
}

function makeStat(label, value) {
  const card = document.createElement("div");
  card.className =
    "flex flex-col items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-center shadow-sm";
  const title = document.createElement("h3");
  title.className = "text-xs font-semibold uppercase tracking-wide text-slate-500";
  title.textContent = label;
  card.appendChild(title);

  if (label === "Recovery score") {
    const percent = parsePercent(value);
    return renderPercentRing(card, percent, recoveryColor(percent));
  }

  if (isSleepPercentLabel(label)) {
    const percent = parsePercent(value);
    return renderPercentRing(card, percent, sleepPercentColor(label, percent));
  }

  if (label === "Habits done") {
    const percent = parsePercent(value);
    return renderPercentRing(card, percent, habitsPercentColor(percent));
  }

  const val = document.createElement("div");
  val.className = "grid h-28 w-full place-items-center text-2xl font-semibold text-slate-900";
  val.textContent = value;
  card.appendChild(val);
  return card;
}

function renderSleepDetails(details) {
  sleepDetailsPrimaryEl.innerHTML = "";
  sleepDetailsSecondaryEl.innerHTML = "";
  if (!details?.length) {
    sleepDetailsPrimaryEl.innerHTML = "<p class=\"text-sm text-slate-500\">No sleep details yet.</p>";
    return;
  }

  const primaryLabels = ["Sleep duration", "Sleep debt", "HRV"];
  const detailMap = new Map(details.map((item) => [item.label, item]));
  const primary = primaryLabels
    .map((label) => detailMap.get(label))
    .filter(Boolean);
  const secondary = details.filter((item) => !primaryLabels.includes(item.label));

  renderStats(sleepDetailsPrimaryEl, primary);
  renderStats(sleepDetailsSecondaryEl, secondary);
}

function renderPercentRing(card, percent, color) {
  const ring = document.createElement("div");
  ring.className = "relative grid h-28 w-28 place-items-center";

  const normalized = Number.isFinite(percent) ? percent : 0;
  const size = 112;
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - normalized / 100);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("class", "absolute inset-0 h-full w-full -rotate-90");

  const track = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  track.setAttribute("cx", String(size / 2));
  track.setAttribute("cy", String(size / 2));
  track.setAttribute("r", String(radius));
  track.setAttribute("fill", "none");
  track.setAttribute("stroke", "#e2e8f0");
  track.setAttribute("stroke-width", String(stroke));

  const progress = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  progress.setAttribute("cx", String(size / 2));
  progress.setAttribute("cy", String(size / 2));
  progress.setAttribute("r", String(radius));
  progress.setAttribute("fill", "none");
  progress.setAttribute("stroke", color);
  progress.setAttribute("stroke-width", String(stroke));
  progress.setAttribute("stroke-linecap", "round");
  progress.setAttribute("stroke-dasharray", String(circumference));
  progress.setAttribute("stroke-dashoffset", String(offset));

  svg.appendChild(track);
  svg.appendChild(progress);
  ring.appendChild(svg);

  const inner = document.createElement("div");
  inner.className =
    "grid h-20 w-20 place-items-center rounded-full border border-slate-200 bg-white text-lg font-semibold text-slate-900 shadow-sm";
  inner.textContent = Number.isFinite(percent) ? `${percent}%` : "-";
  ring.appendChild(inner);

  card.appendChild(ring);
  return card;
}

function parsePercent(value) {
  if (!value) return NaN;
  const cleaned = String(value).replace("%", "").trim();
  const num = Number.parseFloat(cleaned);
  if (!Number.isFinite(num)) return NaN;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function recoveryColor(percent) {
  if (!Number.isFinite(percent)) return "#d96a5a";
  if (percent <= 33) return "#d96a5a";
  if (percent <= 66) return "#e4b446";
  return "#3a9b63";
}

function isSleepPercentLabel(label) {
  return label === "Sleep performance" || label === "Sleep efficiency" || label === "Sleep consistency";
}

function sleepPercentColor(label, percent) {
  if (!Number.isFinite(percent)) return "#e4b446";

  if (label === "Sleep performance") {
    if (percent > 85) return "#3a9b63";
    if (percent >= 70) return "#3a78c2";
    return "#e4b446";
  }

  if (label === "Sleep efficiency") {
    if (percent > 90) return "#3a9b63";
    if (percent >= 80) return "#3a78c2";
    return "#e4b446";
  }

  if (label === "Sleep consistency") {
    if (percent >= 80) return "#3a9b63";
    if (percent >= 70) return "#3a78c2";
    return "#e4b446";
  }

  return "#e4b446";
}

function habitsPercentColor(percent) {
  if (!Number.isFinite(percent)) return "#e4b446";
  return percent >= 50 ? "#3a9b63" : "#e4b446";
}

async function loadPhoneUsage() {
  const phone = await fetchJson("/api/phone");
  renderPhoneUsageSection(phone);

  if (whoopStatus.textContent === "Connected") {
    const [health, habits] = await Promise.all([
      fetchJson("/api/health?source=phone"),
      fetchJson("/api/habits"),
    ]);
    if (health) {
      renderStats(statsEl, buildTopSummary(health.summary, phone, habits));
      renderSleepDetails(health.sleep_details);
    }
  }
}

async function loadFtpFiles() {
  statusLine.textContent = "Loading FTP files...";
  const data = await fetchJson("/api/ftp");
  renderFtpStatus(data);
  if (!data) {
    statusLine.textContent = "Unable to load FTP files.";
    return;
  }
  if (data?.updated_at) {
    statusLine.textContent = `Updated ${new Date(data.updated_at).toLocaleString()}`;
  }
}

function renderPhoneUsageSection(data) {
  if (!data) {
    phoneSummaryEl.innerHTML =
      "<p class=\"text-sm text-slate-500\">Connect Gmail or configure FTP to load phone usage.</p>";
    phoneAppsEl.innerHTML = "";
    return;
  }

  const summary = [];
  if (data.daily?.usage_time) summary.push({ label: "Usage time", value: data.daily.usage_time });
  if (data.daily?.access_count) summary.push({ label: "Access count", value: data.daily.access_count.replace("#", "") });
  if (data.daily?.usage_delta) summary.push({ label: "Change", value: data.daily.usage_delta });

  renderStats(phoneSummaryEl, summary);

  phoneAppsEl.innerHTML = "";
  const apps = (data.top_apps || [])
    .filter((app) => timeToMinutes(app.usage_time) >= PHONE_APP_MINUTES_THRESHOLD)
    .slice(0, 8);
  if (!apps.length) return;
  apps.forEach((app) => {
    const row = document.createElement("div");
    row.className =
      "flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm";
    const left = document.createElement("div");
    left.className = "flex items-center gap-3";
    const icon = createAppIconElement(app.name);
    const name = document.createElement("strong");
    name.className = "text-slate-900";
    name.textContent = app.name;
    const info = document.createElement("span");
    info.className = "text-slate-500";
    info.textContent = `${app.usage_time || "-"}`;
    left.appendChild(icon);
    left.appendChild(name);
    row.appendChild(left);
    row.appendChild(info);
    phoneAppsEl.appendChild(row);
  });
}

function renderFtpStatus(data) {
  if (!ftpSummaryLineEl) return;
  if (!data) {
    ftpSummaryLineEl.textContent = "Configure FTP to load phone usage.";
    return;
  }
  const count = Array.isArray(data.files) ? data.files.length : 0;
  const path = data.path || "/";
  ftpSummaryLineEl.textContent = `FTP reachable. ${count} items in ${path}.`;
}

async function loadHabits() {
  const habits = await fetchJson("/api/habits");
  renderHabitsSection(habits);
}

function renderHabitsSection(data) {
  if (!data) {
    habitSummaryEl.innerHTML = "<p class=\"text-sm text-slate-500\">Add Habitify API key to load habits.</p>";
    habitSummaryEl.style.display = "block";
    habitListEl.innerHTML = "";
    return;
  }

  const habits = data.habits || [];
  habitSummaryEl.innerHTML = "";
  habitSummaryEl.style.display = "none";

  habitListEl.innerHTML = "";
  habits.forEach((habit) => {
    const row = document.createElement("div");
    row.className =
      "flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm";
    const name = document.createElement("strong");
    name.className = "text-slate-900";
    name.textContent = habit.name;
    const badge = document.createElement("span");
    badge.className =
      habit.status === "done"
        ? "rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
        : "rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700";
    badge.textContent = habit.status === "done" ? "Done" : "Not done";
    row.appendChild(name);
    row.appendChild(badge);
    habitListEl.appendChild(row);
  });
}

function buildTopSummary(healthSummary, phone, habits) {
  const summary = Array.isArray(healthSummary) ? healthSummary.slice() : [];
  if (phone?.daily?.usage_time) {
    upsertSummary(summary, "Phone usage", phone.daily.usage_time);
  }
  if (habits?.habits?.length) {
    const done = habits.habits.filter((habit) => habit.status === "done").length;
    const percent = Math.round((done / habits.habits.length) * 100);
    upsertSummary(summary, "Habits done", `${percent}%`);
  }
  return summary;
}

function upsertSummary(summary, label, value) {
  const existing = summary.find((item) => item.label === label);
  if (existing) {
    existing.value = value;
  } else {
    summary.push({ label, value });
  }
}

function timeToMinutes(value) {
  if (!value) return 0;
  const normalized = String(value).trim();
  if (normalized.includes(":")) {
    const parts = normalized.split(":").map((part) => Number.parseInt(part, 10));
    if (parts.length >= 2 && parts.every((part) => Number.isFinite(part))) {
      const [hours, minutes, seconds] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
      return (hours * 60) + minutes + Math.round((seconds || 0) / 60);
    }
  }
  const hoursMatch = value.match(/(\d+)h/i);
  const minutesMatch = value.match(/(\d+)m/i);
  const secondsMatch = value.match(/(\d+)s/i);
  const hours = hoursMatch ? Number.parseInt(hoursMatch[1], 10) : 0;
  const minutes = minutesMatch ? Number.parseInt(minutesMatch[1], 10) : 0;
  const seconds = secondsMatch ? Number.parseInt(secondsMatch[1], 10) : 0;
  return hours * 60 + minutes + Math.round(seconds / 60);
}


function formatNumber(value) {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString();
}

function normalizeAppName(value) {
  return String(value || "").toLowerCase().trim();
}

function getAppIconMeta(appName) {
  const normalized = normalizeAppName(appName);
  if (APP_ICON_MAP.has(normalized)) return APP_ICON_MAP.get(normalized);
  const simplified = normalized.replace(/\s+/g, " ").replace(/[^a-z0-9 ]/g, "");
  return APP_ICON_MAP.get(simplified);
}

function createAppIconElement(appName) {
  const wrapper = document.createElement("div");
  wrapper.className =
    "flex h-7 w-7 items-center justify-center rounded-md bg-white ring-1 ring-slate-200 shadow-sm";

  const meta = getAppIconMeta(appName);
  const img = document.createElement("img");
  img.alt = `${appName} icon`;
  img.loading = "lazy";
  img.className = "h-5 w-5";

  const fallbackToInitials = () => {
    const initials = String(appName || "?")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
    const badge = document.createElement("span");
    badge.className = "text-[10px] font-semibold text-slate-600";
    badge.textContent = initials || "?";
    wrapper.innerHTML = "";
    wrapper.appendChild(badge);
  };

  const setFavicon = () => {
    if (meta?.domain) {
      img.onerror = () => fallbackToInitials();
      img.src = `${FAVICON_BASE}/${meta.domain}?sz=64`;
      wrapper.appendChild(img);
      return true;
    }
    return false;
  };

  if (meta?.slug) {
    img.onerror = () => {
      if (!setFavicon()) fallbackToInitials();
    };
    img.src = `${SIMPLE_ICON_BASE}/${meta.slug}?viewbox=auto`;
    wrapper.appendChild(img);
    return wrapper;
  }

  if (setFavicon()) return wrapper;
  fallbackToInitials();
  return wrapper;
}

init();
