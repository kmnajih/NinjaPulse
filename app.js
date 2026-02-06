const statusLine = document.getElementById("statusLine");
const refreshWhoopBtn = document.getElementById("refreshWhoopBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const disconnectGmailBtn = document.getElementById("disconnectGmailBtn");
const refreshGmailBtn = document.getElementById("refreshGmailBtn");
const statsEl = document.getElementById("stats");
const sleepDetailsEl = document.getElementById("sleepDetails");
const phoneSummaryEl = document.getElementById("phoneSummary");
const phoneAppsEl = document.getElementById("phoneApps");
const habitSummaryEl = document.getElementById("habitSummary");
const habitListEl = document.getElementById("habitList");
const whoopStatus = document.getElementById("whoopStatus");
const gmailStatusEl = document.getElementById("gmailStatus");

const PHONE_APP_MINUTES_THRESHOLD = 30;

refreshWhoopBtn.addEventListener("click", () => loadDashboard());
refreshGmailBtn.addEventListener("click", () => loadPhoneUsage());
disconnectBtn.addEventListener("click", async () => {
  await fetch("/logout", { method: "POST" });
  whoopStatus.textContent = "Not connected";
  statusLine.textContent = "WHOOP disconnected.";
  refreshWhoopBtn.disabled = true;
  disconnectBtn.disabled = true;
  statsEl.innerHTML = "";
  sleepDetailsEl.innerHTML = "";
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
  const status = await fetchJson("/api/status");
  const gmailStatus = await fetchJson("/api/gmail/status");
  if (status?.connected) {
    whoopStatus.textContent = "Connected";
    statusLine.textContent = "Connected. Fetching latest metrics...";
    refreshWhoopBtn.disabled = false;
    disconnectBtn.disabled = false;
    await loadDashboard();
  } else {
    whoopStatus.textContent = "Not connected";
    statusLine.textContent = "Waiting for connection.";
  }

  if (gmailStatus?.connected) {
    disconnectGmailBtn.disabled = false;
    refreshGmailBtn.disabled = false;
    gmailStatusEl.textContent = "Connected";
    await loadPhoneUsage();
  } else {
    gmailStatusEl.textContent = "Not connected";
  }

  await loadHabits();
}

async function loadDashboard() {
  statusLine.textContent = "Loading WHOOP data...";
  const payload = await fetchJson("/api/health");
  if (!payload) {
    statusLine.textContent = "Unable to load data.";
    return;
  }

  whoopStatus.textContent = "Connected";
  refreshWhoopBtn.disabled = false;
  disconnectBtn.disabled = false;
  statusLine.textContent = `Updated ${new Date(payload.generated_at).toLocaleString()}`;

  renderStats(statsEl, payload.summary);
  renderStats(sleepDetailsEl, payload.sleep_details);
  await loadPhoneUsage(payload.summary);
  await loadHabits();
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
    container.innerHTML = "<p>No summary metrics yet.</p>";
    return;
  }

  summary.forEach((item) => {
    container.appendChild(makeStat(item.label, item.value));
  });
}

function makeStat(label, value) {
  const card = document.createElement("div");
  card.className = "stat";
  const title = document.createElement("h3");
  title.textContent = label;
  const val = document.createElement("div");
  val.className = "value";
  val.textContent = value;
  card.appendChild(title);
  card.appendChild(val);
  return card;
}

async function loadPhoneUsage(mainSummary = null) {
  const data = await fetchJson("/api/phone");
  if (!data) {
    phoneSummaryEl.innerHTML = "<p>Connect Gmail to load phone usage.</p>";
    phoneAppsEl.innerHTML = "";
    return;
  }

  if (data.daily?.usage_time) {
    if (mainSummary) {
      mainSummary.push({ label: "Phone usage", value: data.daily.usage_time });
      renderStats(statsEl, mainSummary);
    } else {
      const summary = await fetchJson("/api/health");
      if (summary?.summary) {
        summary.summary.push({ label: "Phone usage", value: data.daily.usage_time });
        renderStats(statsEl, summary.summary);
      }
    }
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
    row.className = "list-item";
    const name = document.createElement("strong");
    name.textContent = app.name;
    const info = document.createElement("span");
    info.textContent = `${app.usage_time || "-"}`;
    row.appendChild(name);
    row.appendChild(info);
    phoneAppsEl.appendChild(row);
  });
}

async function loadHabits() {
  const data = await fetchJson("/api/habits");
  if (!data) {
    habitSummaryEl.innerHTML = "<p>Add Habitify API key to load habits.</p>";
    habitListEl.innerHTML = "";
    return;
  }

  const habits = data.habits || [];
  const done = habits.filter((habit) => habit.status === "done").length;
  const pending = habits.filter((habit) => habit.status !== "done").length;
  renderStats(habitSummaryEl, [
    { label: "Done", value: String(done) },
    { label: "Not done", value: String(pending) },
  ]);

  habitListEl.innerHTML = "";
  habits.forEach((habit) => {
    const row = document.createElement("div");
    row.className = "list-item";
    const name = document.createElement("strong");
    name.textContent = habit.name;
    const badge = document.createElement("span");
    badge.className = habit.status === "done" ? "badge done" : "badge pending";
    badge.textContent = habit.status === "done" ? "Done" : "Not done";
    row.appendChild(name);
    row.appendChild(badge);
    habitListEl.appendChild(row);
  });
}

function timeToMinutes(value) {
  if (!value) return 0;
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

init();
