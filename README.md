# Bucket Budget

A private, single-user iPhone web app (PWA) that splits each salary into buckets and deducts spending automatically from bank SMS.

Everything runs on Cloudflare's free plan: the app is hosted on **Pages**, the API and SMS webhook are **Pages Functions**, and data lives in a **D1** (SQLite) database. No login screen: the app holds a long key you enter once per device, and the iPhone Shortcut holds a second key that can only post SMS.

## Layout

- `src/core/` – pure money logic (cycles, allocation, sinking funds, statuses, ledger). No UI or database code.
- `src/data/` – app state, operations, and `commands.ts`: every change as a small JSON command that runs identically on the phone and on the server.
- `functions/api/` – the HTTP endpoints (`state`, `commands`, `sms`, `health`).
- `server/` – database access shared by the endpoints.
- `cloudflare/migrations/` – the D1 schema.

## Rules worth knowing

- Money is integer paise everywhere.
- A bucket's balance is the sum of its ledger entries; entries are append-only.
- Overspending is allowed and shows as a negative balance. Nothing is borrowed automatically; covering from the buffer is an explicit `cover` move.
- At cycle close, flexible buckets are swept to ₹0 against the buffer, so overspends reduce the buffer.
- Only a redacted copy of each SMS is stored (account numbers, balances and references removed).

## Commands

```sh
npm test                 # logic tests
npm run dev              # app on http://localhost:5173 (uses the local API below when it runs)
npm run build && npm run dev:api   # app + API + local database on http://localhost:8788
npm run db:migrate:local # create the tables in the local database (once)
```

For the local API, create `.dev.vars` (git-ignored) with two keys:

```sh
printf 'APP_KEY=%s\nSMS_KEY=%s\n' "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" > .dev.vars
```

---

## Going live (free, about 15 minutes)

### 1. Cloudflare account and database

1. Sign up at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up) (free plan, no card needed).
2. In this folder:

   ```sh
   npx wrangler login
   npx wrangler d1 create bucketbudget
   ```

3. Copy the `database_id` it prints into `wrangler.toml` (replace the zeros). It is not a secret, so commit it.
4. Create the tables:

   ```sh
   npm run db:migrate
   ```

### 2. Make two keys

Generate two long random keys and keep them in your password manager. Never commit them or paste them into chats.

```sh
openssl rand -hex 24   # APP_KEY: for the app on each device
openssl rand -hex 24   # SMS_KEY: for the iPhone Shortcut only
```

### 3. Deploy the app

**Option A: from GitHub (redeploys on every push)**

1. Push this repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → pick the repo.
3. Build settings: framework **None**, build command `npm run build`, output directory `dist`.
   Under **Environment variables** add `NODE_VERSION` = `24`.
4. Save and deploy. Your app is at `https://<project>.pages.dev`.

**Option B: from this Mac**

```sh
npm run deploy
```

Then, either way:

5. Add the two keys as secrets (each command asks you to paste the value):

   ```sh
   npx wrangler pages secret put APP_KEY --project-name <project>
   npx wrangler pages secret put SMS_KEY --project-name <project>
   ```

   Or in the dashboard: Pages project → **Settings** → **Variables and secrets** → add both as type **Secret**.
6. The database binding (`DB`) comes from `wrangler.toml`; Pages project → **Settings** → **Bindings** should list it.
7. Redeploy (Deployments → ⋯ → **Retry deployment**, or `npm run deploy`) so the secrets apply.
8. Open `https://<project>.pages.dev/api/health`. You want:

   ```json
   {"ok":true,"database":"ok","keys":{"app":true,"sms":true}}
   ```

### 4. Install on the iPhone

1. Open `https://<project>.pages.dev` in **Safari**.
2. Share → **Add to Home Screen**. Open it from the Home Screen icon from now on.
3. In the app: Home → Settings → **Connect to your server** → paste `APP_KEY`.
   - The first device uploads its data. Later devices download what's on the server.
   - Tick "Replace whatever is on the server…" only if you want this phone's data to win.
4. Settings now shows **Live** and the webhook URL. Tap **Copy** next to it.

Changes made offline wait on the phone and are sent when you're back online. The app refreshes when you open it and every minute while it's open.

### 5. iPhone Shortcut: forward bank SMS to the webhook

Create the automation once:

1. **Shortcuts** app → **Automation** → **+** → **Message**.
2. **Message Contains**: a word your bank always uses, e.g. `debited`. (Make a second automation for `credited`, or use the bank's sender name in **Sender** instead.)
3. Choose **Run Immediately** and turn off **Notify When Run**.
4. Tap **New Blank Automation** and add these actions:

   | Action | Setting |
   | --- | --- |
   | **Get Contents of URL** | URL: `https://<project>.pages.dev/api/sms` |
   | | Method: **POST** |
   | | Headers: `Authorization` = `Bearer <SMS_KEY>` |
   | | Request Body: **JSON** → add field `text` (Text) = the **Shortcut Input** variable (tap it and pick *Content*) |

5. Optional: add **Show Notification** with *Contents of URL* to see the result while you test (e.g. `₹349 SWIGGY → Eating out`). Remove it once you trust it.

Test it without waiting for a real payment: tap the automation → run it, or from the Mac:

```sh
curl -X POST https://<project>.pages.dev/api/sms \
  -H "Authorization: Bearer $SMS_KEY" -H "Content-Type: application/json" \
  -d '{"text":"Rs.349.00 debited from A/c XX4521 to VPA swiggy@icici. -HDFC Bank"}'
```

The response says what happened: `applied` (went to a bucket), `inbox` (needs you to pick a bucket), `billed`, `transfer`, `ignored` (OTPs, promotions) or `duplicate`.

### API reference

| Endpoint | Key | What it does |
| --- | --- | --- |
| `POST /api/sms` | SMS_KEY | Body `{"text": "..."}` or the raw SMS as plain text. Optional `receivedAt` (ISO time). |
| `GET /api/state` | APP_KEY | Whole data set; `?rev=N` returns `unchanged` if nothing changed. |
| `PUT /api/state` | APP_KEY | First upload. `{"state": ..., "replace": true}` overwrites. |
| `POST /api/commands` | APP_KEY | `{"commands": [...]}` from the app. Safe to resend. |
| `GET /api/health` | none | Database and key configuration check. |

Keys go in an `Authorization: Bearer <key>` header.

### Free-plan headroom

Pages hosting is unlimited, Functions allow 100,000 requests a day, and D1 gives 5 GB. One person's budget uses a tiny fraction of that.

### If something's off

- **Health says database unreachable**: run `npm run db:migrate` and check the `DB` binding.
- **App says the key isn't right**: the secret must match exactly; after changing a secret, redeploy.
- **Shortcut gets 401**: the header must be `Authorization` with value `Bearer ` (with the space) followed by SMS_KEY.
- **"Nothing on the server yet"**: connect the app once first so it uploads your data.
- **Lost the key**: set a new secret in Cloudflare, redeploy, and reconnect each device.
