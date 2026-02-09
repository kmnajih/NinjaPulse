# Personal Health Dashboard (WHOOP)

Local-only website that connects to the WHOOP API via OAuth, fetches your health data, and renders charts.

## 1) Create a WHOOP developer app

Create an app in the WHOOP developer portal and set the redirect URL to:

```
http://localhost:8787/callback
```

You will get a **Client ID** and **Client Secret**.

## 2) Put credentials in a local file

Create a `.env` file in the project root with:

```
WHOOP_CLIENT_ID="your-client-id"
WHOOP_CLIENT_SECRET="your-client-secret"
```

Optional overrides:

```
WHOOP_REDIRECT_URI="http://localhost:8787/callback"
WHOOP_SCOPES="read:recovery read:cycles read:workout read:sleep read:profile read:body_measurement offline"
PORT=8787
NODE_EXTRA_CA_CERTS="/etc/ssl/cert.pem"
GMAIL_CLIENT_ID="your-gmail-client-id"
GMAIL_CLIENT_SECRET="your-gmail-client-secret"
GMAIL_REDIRECT_URI="http://localhost:8787/gmail/callback"
GMAIL_SCOPES="https://www.googleapis.com/auth/gmail.readonly"
GMAIL_SUBJECT_QUERY="subject:\"[App Usage]\" subject:\"Daily usage digest\""
HABITIFY_API_KEY="your-habitify-api-key"
FTP_HOST="your-ftp-host"
FTP_PORT="21"
FTP_USER="your-ftp-user"
FTP_PASSWORD="your-ftp-password"
FTP_PATH="/"
FTP_PASSIVE="true"
```

You can still use shell exports if you prefer.

## 3) Run the local server

```
./start.sh
```

## Gmail setup (for phone usage)

1. Create a Google Cloud project.
2. Enable the **Gmail API** for the project.
3. Configure the OAuth consent screen (External is fine).
4. Create **OAuth Client ID** of type **Web application**.
5. Add authorized redirect URI:
   - `http://localhost:8787/gmail/callback`
6. Put the Client ID/Secret in your `.env` as `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET`.

Then open the dashboard and click **Connect Gmail**.

## Habitify setup

Add your Habitify API key to `.env` as `HABITIFY_API_KEY`. The dashboard will load habits from the Habitify Journal endpoint.

Then open `http://localhost:8787` and click **Connect WHOOP**.

## What the app does

- OAuth flow handled locally (tokens stored in `data/tokens.json`).
- Refresh tokens are used automatically when the access token expires.
- Fetches the last 30 days from WHOOP endpoints based on the scopes granted (up to 25 records per endpoint):
  - `read:recovery` → `/v2/recovery`
  - `read:sleep` → `/v2/activity/sleep`
  - `read:cycles` → `/v2/cycle`
  - `read:workout` → `/v2/activity/workout`

## Project structure

- `server.js` - HTTP server and routing.
- `lib/` - shared helpers and service modules.
  - `lib/services/whoop.js` - WHOOP OAuth + API client.
  - `lib/services/gmail.js` - Gmail OAuth + API client.
  - `lib/parsers/appUsage.js` - App Usage email parsing.
  - `lib/health.js` - Health normalization + summary building.

## Debug logs

Each external service call writes the raw JSON response to `data/logs/` using a stable filename (one file per API call). New responses overwrite the previous file so logs stay compact.
- All numeric fields are charted automatically.

## Notes

- This is **local-only**. Nothing is sent to third parties besides WHOOP.
- On Raspberry Pi, set the same env vars and run `node server.js` the same way.
