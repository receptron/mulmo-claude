# @mulmobridge/teams

> **Experimental** — please test and [report issues](https://github.com/receptron/mulmoclaude/issues/new).

Microsoft Teams bridge for [MulmoClaude](https://github.com/receptron/mulmoclaude). Uses the official [Bot Framework](https://learn.microsoft.com/en-us/azure/bot-service/) webhook protocol via the `botbuilder` SDK. Teams posts activities to the bridge's `/api/messages` endpoint — so this bridge **requires a public URL** (ngrok / Cloudflare Tunnel / reverse proxy).

## Setup

Teams is the most involved bridge because of Azure AD. Plan ~15 min.

### 1. Register an Azure Bot

1. Go to the [Azure Portal](https://portal.azure.com/) → **Create a resource** → search **Azure Bot** → **Create**.
2. Bot handle: pick one (e.g. `mulmobridge-bot`).
3. Subscription / Resource Group: any (free tier works).
4. Pricing tier: **F0** (free) or **S1**.
5. Microsoft App ID → **Create new Microsoft App ID** → **Multi-tenant** (recommended).
6. Create, then open the resource → **Configuration**:
   - Copy **Microsoft App ID** → this is `MICROSOFT_APP_ID`.
   - Click **Manage Password** → **New client secret** → copy the **Value** (once only) → this is `MICROSOFT_APP_PASSWORD`.
7. Still in **Configuration**, set **Messaging endpoint** to `https://<your-public-url>/api/messages` (fill in after you start the bridge + tunnel).

### 2. Add the Teams channel

In the Azure Bot resource → **Channels** → **Microsoft Teams** → Agree → Save.

### 3. Install the bot in Teams

1. Get **Bot App ID** (same as `MICROSOFT_APP_ID`).
2. In Teams, **Apps** → **Manage your apps** → **Upload an app** → **Upload a custom app** → choose a manifest zip. A minimal manifest is:

   ```json
   {
     "$schema": "https://developer.microsoft.com/en-us/json-schemas/teams/v1.17/MicrosoftTeams.schema.json",
     "manifestVersion": "1.17",
     "version": "0.1.0",
     "id": "<NEW_GUID>",
     "packageName": "com.example.mulmobridge",
     "developer": {
       "name": "MulmoBridge",
       "websiteUrl": "https://example.com",
       "privacyUrl": "https://example.com/privacy",
       "termsOfUseUrl": "https://example.com/terms"
     },
     "icons": { "color": "color.png", "outline": "outline.png" },
     "name": { "short": "MulmoBridge", "full": "MulmoBridge for MulmoClaude" },
     "description": { "short": "Talk to MulmoClaude from Teams.", "full": "Bridges Microsoft Teams DMs to a MulmoClaude agent." },
     "accentColor": "#2d89ef",
     "bots": [
       {
         "botId": "<MICROSOFT_APP_ID>",
         "scopes": ["personal", "team", "groupchat"],
         "supportsFiles": false,
         "isNotificationOnly": false
       }
     ],
     "permissions": ["identity", "messageTeamMembers"],
     "validDomains": []
   }
   ```

   Generate a fresh GUID for `id`, substitute `<MICROSOFT_APP_ID>` for `botId`. Zip the manifest.json plus two placeholder PNGs (color.png 192×192 and outline.png 32×32) into an App Package.

### 4. Expose the bridge with a tunnel

```bash
ngrok http 3006
# copy the https URL, paste into Azure Bot → Configuration → Messaging endpoint
# (append /api/messages)
```

### 5. Run the bridge

```bash
# With real MulmoClaude
MICROSOFT_APP_ID=... \
MICROSOFT_APP_PASSWORD=... \
npx @mulmobridge/teams
```

Message your bot in Teams — DM or @mention in a channel — and you'll get a reply.

## Environment variables

| Variable                   | Required    | Default       | Description |
|----------------------------|-------------|---------------|-------------|
| `MICROSOFT_APP_ID`         | yes         | —             | Azure Bot App ID (aka MicrosoftAppId) |
| `MICROSOFT_APP_PASSWORD`   | yes         | —             | Azure Bot client secret |
| `MICROSOFT_APP_TYPE`       | no          | `MultiTenant` | `MultiTenant` / `SingleTenant` / `UserAssignedMSI` |
| `MICROSOFT_APP_TENANT_ID`  | conditional | —             | Required when `MICROSOFT_APP_TYPE=SingleTenant` |
| `TEAMS_BRIDGE_PORT`        | no          | `3006`        | HTTP port to listen on |
| `TEAMS_ALLOWED_USERS`      | no          | (all)         | CSV of AAD user object IDs — empty = accept everyone in the tenant |
| `MULMOCLAUDE_AUTH_TOKEN`   | no          | auto          | MulmoClaude bearer token override |
| `MULMOCLAUDE_API_URL`      | no          | `http://localhost:3001` | MulmoClaude server URL |

## How it works

1. Teams sends every user activity to `POST /api/messages` signed with a Bearer JWT issued by Azure AD. The Bot Framework SDK validates the token against Azure's JWKS using the configured `MICROSOFT_APP_ID` + `MICROSOFT_APP_PASSWORD`.
2. For `type=message` activities, the bridge caches a conversation reference (needed for server-initiated pushes), then forwards `activity.text` to MulmoClaude keyed by `activity.conversation.id`.
3. Replies go back via `TurnContext.sendActivity`, chunked at ~28 k chars.
4. When MulmoClaude pushes an event (e.g. scheduler notification), the bridge uses `adapter.continueConversationAsync` with the cached reference to deliver it to Teams.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| 401 on `/api/messages` | Wrong app ID / password | Double-check Azure Bot → Configuration |
| Bot doesn't reply in Teams | Messaging endpoint not set or tunnel URL stale | Update Azure Bot → Configuration → Messaging endpoint |
| `ngrok` URL changes on restart | Free ngrok plan assigns random URLs | Use a reserved domain, Cloudflare Tunnel, or static ingress |
| Push messages dropped | No conversation reference yet cached | User must message the bot first — push works from the second turn onward |

## Security notes

- The client secret grants bot-impersonation in the entire AAD tenant. Store it as a proper secret (env var, vault, Azure Key Vault) and rotate on schedule.
- Teams endpoints must be HTTPS — Azure rejects plain HTTP messaging endpoints. Use a tunnel with a valid cert.
- Use `TEAMS_ALLOWED_USERS` (AAD user object IDs) to restrict access when deploying to a multi-user tenant.
- Bot Framework requires Azure AD — there is no passwordless / self-hosted path. For a fully self-hosted Teams alternative, consider `@mulmobridge/mattermost` or `@mulmobridge/rocketchat`.
