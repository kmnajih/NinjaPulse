function extractHtmlBody(raw) {
  const parts = raw.split(/\r?\n\r?\n/);
  if (parts.length <= 1) return raw;
  return parts.slice(1).join("\n\n");
}

function decodeQuotedPrintable(input) {
  return input
    .replace(/=\r?\n/g, "")
    .replace(/=([A-Fa-f0-9]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeBase64Url(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + (4 - (normalized.length % 4)) % 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

function stripHtml(input) {
  const withoutTags = input.replace(/<[^>]*>/g, "\n");
  return decodeEntities(withoutTags);
}

function decodeEntities(input) {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function parseDailyUsage(lines) {
  const usageIndex = lines.findIndex((line) => line.toLowerCase() === "usage time");
  if (usageIndex === -1) return null;

  const dateLineIndex = lines.slice(usageIndex).findIndex((line) => /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),/i.test(line));
  if (dateLineIndex === -1) return null;
  const idx = usageIndex + dateLineIndex;

  const date = lines[idx];
  const usageTime = lines[idx + 1] || null;
  const delta = lines[idx + 2] || null;
  const accessCount = lines.slice(idx + 1, idx + 6).find((line) => /^#\d+/.test(line)) || null;
  const accessDelta = accessCount ? lines[lines.indexOf(accessCount) + 1] || null : null;

  return { date, usage_time: usageTime, usage_delta: delta, access_count: accessCount, access_delta: accessDelta };
}

function parseTopApps(lines) {
  const start = lines.findIndex((line) => line.toLowerCase() === "top apps");
  if (start === -1) return [];
  const end = lines.slice(start + 1).findIndex((line) => line.toLowerCase() === "pinned apps");
  const sliceEnd = end === -1 ? lines.length : start + 1 + end;
  const segment = lines.slice(start + 1, sliceEnd);

  const apps = [];
  for (let i = 1; i < segment.length; i += 1) {
    const line = segment[i];
    if (!isTimeValue(line)) continue;
    const name = segment[i - 1];
    if (!name || /usage time|access count/i.test(name)) continue;

    const delta = segment[i + 1] && isDelta(segment[i + 1]) ? segment[i + 1] : null;
    const access = segment[i + 2] && /^#\d+/.test(segment[i + 2]) ? segment[i + 2] : null;
    const accessDelta = segment[i + 3] && isDelta(segment[i + 3]) ? segment[i + 3] : null;

    apps.push({ name, usage_time: line, usage_delta: delta, access_count: access, access_delta: accessDelta });
  }

  return apps;
}

function isTimeValue(line) {
  return /\b\d+h\b|\b\d+m\b|\b\d+s\b/i.test(line);
}

function isDelta(line) {
  return /^[+-]\d+%$/.test(line) || /^[-+]\d+%/.test(line);
}

function parseUsageEmail(raw) {
  const html = extractHtmlBody(raw);
  if (!html) return null;
  const text = stripHtml(decodeQuotedPrintable(html));
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  return {
    daily: parseDailyUsage(lines),
    top_apps: parseTopApps(lines),
  };
}

module.exports = {
  decodeBase64Url,
  parseUsageEmail,
};
