const { writeJson, readJson } = require("./fs");

function extractRecords(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.records)) return payload.records;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

function flattenRecord(record) {
  const output = {};
  const stack = [{ prefix: "", value: record }];

  while (stack.length) {
    const { prefix, value } = stack.pop();
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.entries(value).forEach(([key, val]) => {
        const nextPrefix = prefix ? `${prefix}.${key}` : key;
        if (val && typeof val === "object" && !Array.isArray(val)) {
          stack.push({ prefix: nextPrefix, value: val });
        } else {
          output[nextPrefix] = val;
        }
      });
    }
  }

  return output;
}

function pickDate(record) {
  const candidates = [
    "start",
    "end",
    "created_at",
    "updated_at",
    "timestamp",
    "cycle_start",
    "cycle_end",
  ];
  for (const key of candidates) {
    if (record[key]) return record[key];
  }
  const fallback = Object.values(record).find((value) => typeof value === "string" && value.includes("T"));
  return fallback || null;
}

function normalize(records) {
  return records
    .map((record) => {
      const flat = flattenRecord(record);
      const date = pickDate(flat);
      const normalized = { date };
      Object.entries(flat).forEach(([key, value]) => {
        if (value === null || value === undefined) return;
        if (typeof value === "number") {
          normalized[key] = value;
          return;
        }
        if (typeof value === "string" && value.trim() !== "") {
          const cleaned = value.replace(/[^0-9.+-]/g, "");
          const num = Number.parseFloat(cleaned);
          if (!Number.isNaN(num)) {
            normalized[key] = num;
          }
        }
      });
      return normalized;
    })
    .filter((record) => record.date || Object.keys(record).length > 1);
}

function buildSummary(datasets) {
  const summary = [];
  const sleepDetails = [];
  const sleep = datasets.find((dataset) => dataset.name === "Sleep");
  const recovery = datasets.find((dataset) => dataset.name === "Recovery");

  if (sleep) {
    const timeInBed = findLatestSleepMetric(sleep.records, {
      label: "Time in bed",
      key: "score.stage_summary.total_in_bed_time_milli",
      format: "duration",
    });
    if (timeInBed) summary.push({ label: "Time in bed", value: timeInBed });

    const sleepMetrics = [
      { label: "Sleep duration", key: "sleep.total_duration", format: "sleep_duration" },
      { label: "Sleep performance", key: "score.sleep_performance_percentage", format: "percent" },
      { label: "Sleep efficiency", key: "score.sleep_efficiency_percentage", format: "percent" },
      { label: "Sleep consistency", key: "score.sleep_consistency_percentage", format: "percent" },
      { label: "Sleep debt", key: "score.sleep_needed.need_from_sleep_debt_milli", format: "duration" },
    ];

    sleepMetrics.forEach((metric) => {
      const value = findLatestSleepMetric(sleep.records, metric);
      if (value) sleepDetails.push({ label: metric.label, value });
    });
  }

  if (recovery) {
    const recoveryMetrics = [
      { label: "Recovery score", key: "score.recovery_score", format: "percent" },
    ];

    recoveryMetrics.forEach((metric) => {
      const value = metric.format === "percent"
        ? latestPercent(recovery.records, metric.key)
        : latestValue(recovery.records, metric.key);
      if (value) summary.push({ label: metric.label, value });
    });

    const hrvValue = latestValue(recovery.records, "score.hrv_rmssd_milli");
    if (hrvValue) sleepDetails.push({ label: "HRV", value: hrvValue });
  }

  return {
    summary: reorderSummary(summary),
    sleep_details: sleepDetails,
  };
}

function reorderSummary(summary) {
  const priority = [
    "Time in bed",
    "Recovery score",
    "Sleep duration",
    "Sleep performance",
    "Sleep efficiency",
    "Sleep consistency",
    "Sleep debt",
  ];
  const ordered = [];
  priority.forEach((label) => {
    const idx = summary.findIndex((item) => item.label === label);
    if (idx !== -1) {
      ordered.push(summary[idx]);
      summary.splice(idx, 1);
    }
  });
  return ordered.concat(summary);
}

function findLatestSleepMetric(records, metric) {
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const record = records[i];
    if (metric.format === "sleep_duration") {
      const duration = computeSleepDuration(record);
      if (duration) return duration;
      continue;
    }

    const value = record[metric.key];
    if (!Number.isFinite(value)) continue;
    if (metric.format === "percent") return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
    if (metric.format === "duration") return formatDuration(value);
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return null;
}

function computeSleepDuration(record) {
  const totalMillis = [
    record["score.stage_summary.total_light_sleep_time_milli"],
    record["score.stage_summary.total_rem_sleep_time_milli"],
    record["score.stage_summary.total_slow_wave_sleep_time_milli"],
  ].reduce((sum, val) => sum + (Number.isFinite(val) ? val : 0), 0);
  if (!totalMillis) return null;
  return formatDuration(totalMillis);
}

function formatDuration(millis) {
  if (!Number.isFinite(millis)) return null;
  const totalMinutes = Math.round(millis / 1000 / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function latestPercent(records, key) {
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const value = records[i][key];
    if (Number.isFinite(value)) return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
  }
  return null;
}

function latestValue(records, key) {
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const value = records[i][key];
    if (Number.isFinite(value)) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return null;
}

function lastDaysRange(days) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - days);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function parseScopes(scopeString) {
  if (!scopeString) return new Set();
  return new Set(scopeString.split(/\s+/).filter(Boolean));
}

async function handleApiHealth({ whoopClient, paths, sendJson }) {
  const tokens = readJson(paths.whoop.tokenPath);
  const token = await whoopClient.getAccessToken();
  if (!token) {
    sendJson(401, { error: "Not connected" });
    return;
  }

  const { start, end } = lastDaysRange(30);
  const scopes = parseScopes(tokens?.scope);
  const requests = [];

  if (scopes.has("read:recovery")) {
    requests.push({ name: "Recovery", path: "/v2/recovery" });
  }
  if (scopes.has("read:sleep")) {
    requests.push({ name: "Sleep", path: "/v2/activity/sleep" });
  }
  if (scopes.has("read:cycles")) {
    requests.push({ name: "Cycles", path: "/v2/cycle" });
  }
  if (scopes.has("read:workout")) {
    requests.push({ name: "Workouts", path: "/v2/activity/workout" });
  }

  const responses = await Promise.all(
    requests.map((req) =>
      whoopClient.get(req.path, { start, end, limit: 25 }).then((payload) => ({
        name: req.name,
        payload,
      }))
    )
  );

  const datasets = responses
    .map((response) => {
      let records = extractRecords(response.payload);
      if (response.name === "Sleep") {
        records = records.filter((record) => record?.nap !== true);
      }
      return {
        name: response.name,
        records: normalize(records),
      };
    })
    .filter((dataset) => dataset.records.length);

  datasets.forEach((dataset) => {
    dataset.records.sort((a, b) => {
      if (!a.date || !b.date) return 0;
      return new Date(a.date) - new Date(b.date);
    });
  });

  const summaryPayload = buildSummary(datasets);

  writeJson(paths.whoop.healthPath, {
    generated_at: new Date().toISOString(),
    summary: summaryPayload.summary,
    sleep_details: summaryPayload.sleep_details,
    datasets,
  });

  sendJson(200, {
    generated_at: new Date().toISOString(),
    summary: summaryPayload.summary,
    sleep_details: summaryPayload.sleep_details,
    datasets,
  });
}

module.exports = { handleApiHealth };
