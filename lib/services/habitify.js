function createHabitifyClient({ requestJson, config, logger }) {
  const API_BASE = "https://api.habitify.me";

  function buildHeaders() {
    return { Authorization: config.apiKey };
  }

  async function getJournal(targetDate) {
    const urlObj = new URL(`${API_BASE}/journal`);
    if (targetDate) urlObj.searchParams.set("target_date", targetDate);

    const payload = await requestJson(urlObj.toString(), {
      headers: buildHeaders(),
    });
    if (logger) logger.logJson("habitify", "journal", payload);
    return payload;
  }

  return { getJournal };
}

module.exports = { createHabitifyClient };
