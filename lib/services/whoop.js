function createWhoopClient({ requestJson, config, paths, readJson, writeJson, logger }) {
  const API_BASE = "https://api.prod.whoop.com/developer";
  const AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
  const TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";

  async function exchangeToken(code) {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    });

    const payload = await requestJson(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (logger) logger.logJson("whoop", "token_exchange", payload);
    const expiresAt = Date.now() + payload.expires_in * 1000;
    writeJson(paths.whoop.tokenPath, { ...payload, expires_at: expiresAt });
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

    const payload = await requestJson(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (logger) logger.logJson("whoop", "token_refresh", payload);
    const expiresAt = Date.now() + payload.expires_in * 1000;
    writeJson(paths.whoop.tokenPath, { ...payload, expires_at: expiresAt });
    return payload.access_token;
  }

  async function getAccessToken() {
    const tokens = readJson(paths.whoop.tokenPath);
    if (!tokens) return null;
    return refreshTokenIfNeeded(tokens);
  }

  async function get(pathname, query) {
    const token = await getAccessToken();
    if (!token) return null;

    const urlObj = new URL(`${API_BASE}${pathname}`);
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        urlObj.searchParams.set(key, value);
      }
    });

    const payload = await requestJson(urlObj.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (logger) logger.logJson("whoop", pathname, payload);
    return payload;
  }

  function buildAuthUrl(state) {
    const authUrl = new URL(AUTH_URL);
    authUrl.searchParams.set("client_id", config.clientId);
    authUrl.searchParams.set("redirect_uri", config.redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", config.scopes);
    authUrl.searchParams.set("state", state);
    return authUrl.toString();
  }

  return {
    exchangeToken,
    getAccessToken,
    get,
    buildAuthUrl,
  };
}

module.exports = { createWhoopClient };
