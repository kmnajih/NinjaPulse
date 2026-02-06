const { decodeBase64Url, parseUsageEmail } = require("../parsers/appUsage");

function createGmailClient({ requestJson, config, paths, readJson, writeJson, logger }) {
  const GMAIL_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
  const GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token";
  const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";

  async function exchangeToken(code) {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });

    const payload = await requestJson(GMAIL_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (logger) logger.logJson("gmail", "token_exchange", payload);
    const expiresAt = Date.now() + payload.expires_in * 1000;
    writeJson(paths.gmail.tokenPath, { ...payload, expires_at: expiresAt });
    return payload.access_token;
  }

  async function refreshTokenIfNeeded(tokens) {
    if (!tokens?.refresh_token) return null;
    const now = Date.now();
    if (!tokens.expires_at || now < tokens.expires_at - 60000) {
      return tokens.access_token;
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });

    const payload = await requestJson(GMAIL_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (logger) logger.logJson("gmail", "token_refresh", payload);

    const expiresAt = Date.now() + payload.expires_in * 1000;
    writeJson(paths.gmail.tokenPath, { ...payload, expires_at: expiresAt });
    return payload.access_token;
  }

  async function getAccessToken() {
    const tokens = readJson(paths.gmail.tokenPath);
    if (!tokens) return null;
    return refreshTokenIfNeeded(tokens);
  }

  async function get(pathname, query, tokenOverride) {
    const token = tokenOverride || (await getAccessToken());
    if (!token) return null;

    const urlObj = new URL(`${GMAIL_API_BASE}${pathname}`);
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        urlObj.searchParams.set(key, value);
      }
    });
    const payload = await requestJson(urlObj.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (logger) logger.logJson("gmail", pathname.replace(/\//g, "_"), payload);
    return payload;
  }

  function buildAuthUrl(state) {
    const authUrl = new URL(GMAIL_AUTH_URL);
    authUrl.searchParams.set("client_id", config.clientId);
    authUrl.searchParams.set("redirect_uri", config.redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", config.scopes);
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", state);
    return authUrl.toString();
  }

  async function fetchLatestUsageEmail() {
    const token = await getAccessToken();
    if (!token) return null;

    const list = await get("/users/me/messages", {
      q: config.subjectQuery,
      maxResults: 1,
    }, token);
    if (logger) logger.logJson("gmail", "messages_list", list);
    const messageId = list?.messages?.[0]?.id;
    if (!messageId) return null;

    const message = await get(`/users/me/messages/${messageId}`, { format: "raw" }, token);
    if (logger) logger.logJson("gmail", "message_raw", message);
    if (!message?.raw) return null;
    const raw = decodeBase64Url(message.raw);

    const parsed = parseUsageEmail(raw);
    if (!parsed) return null;

    return {
      generated_at: new Date().toISOString(),
      source_message_id: messageId,
      daily: parsed.daily,
      top_apps: parsed.top_apps,
    };
  }

  return {
    exchangeToken,
    getAccessToken,
    buildAuthUrl,
    fetchLatestUsageEmail,
  };
}

module.exports = { createGmailClient };
