# Baileys WhatsApp Send API

Developed by Mohammad Rameez Imdad (Rameez Scripts)
WhatsApp: https://wa.me/923224083545 (For Custom Projects)
YouTube: https://www.youtube.com/@rameezimdad (Subscribe for more!)

WhatsApp **send-only** REST API with a web dashboard. Scan a QR once, then send messages from any app with a simple HTTP call. Incoming messages are ignored (never read, never stored).

> Use only for lawful, consent-based messaging. Messages go out one-by-one with a 5.5s anti-ban gap.

---

## Install on a VPS (Ubuntu 22.04 / 24.04)

> This repo is **private**. Before installing: on github.com open the repo → Settings → Danger Zone → **Change visibility → Public**. After install, set it back to **Private** the same way. (Token method: see [INSTALL.md](INSTALL.md))

Open your VPS terminal (Hostinger hPanel → VPS → **Browser terminal**, login `root`).
Paste commands **one at a time** — long pastes break in browser terminals.

### Step 1 — Remove old install (skip on a brand-new VPS)

```bash
pm2 delete baileys-api
```
```bash
rm -rf /opt/baileys-api ~/baileys-api
```
```bash
rm -f /etc/nginx/sites-enabled/baileys-api /etc/nginx/sites-available/baileys-api
```

### Step 2 — Install (everything is automatic)

```bash
apt install -y git
```
```bash
git clone https://github.com/rameezimdad/baileys-api.git
```
```bash
bash baileys-api/deploy/vps-install.sh
```

Takes 3–5 minutes. At the end a green box prints:

- `Dashboard: http://YOUR_VPS_IP/`
- **ADMIN API KEY** → **copy and save it NOW** (shown only once)

### Step 3 — Domain (optional, recommended)

Cloudflare → add your domain → DNS: `A @ → YOUR_VPS_IP` and `A www → YOUR_VPS_IP`, both **Proxied (orange cloud)** → set the Cloudflare nameservers at your registrar.

⚠️ **Important:** Cloudflare → **SSL/TLS → Overview → mode "Flexible"** — otherwise you get error 522 (the VPS itself has no SSL; Cloudflare provides it).

Then on the VPS:

```bash
sed -i 's|^PUBLIC_DOMAIN=.*|PUBLIC_DOMAIN=yourdomain.com|' /opt/baileys-api/.env
```
```bash
pm2 restart baileys-api --update-env
```

### Step 4 — Connect WhatsApp

1. Open `https://yourdomain.com/` (or `http://YOUR_VPS_IP/`)
2. Paste the ADMIN API KEY → Unlock
3. Phone: WhatsApp → Settings → **Linked devices** → **Link a device** → scan the QR
4. Connected ✅ — the page shows: test-send form, **API Keys panel** (create/copy/revoke keys), and ready-made API examples for your domain + VPS IP

---

## Send messages from your apps

```bash
curl -X POST https://yourdomain.com/api/send-message \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to":"923001234567","message":"Hello"}'
```

- Number = country code + number, **no `+`** (e.g. `923001234567`)
- Endpoints: `/api/send-message`, `/api/send-image`, `/api/send-document`, `/api/send-audio` (multipart field `file`), `/api/send-location`
- Bulk sends: extra messages return `"status":"queued"` instantly and go out automatically with the anti-ban gap
- Create one key per app from the dashboard's **API Keys** panel (keep the admin key for yourself)

## Update the server to latest code

(Repo must be public for the moment of update, same as install)

```bash
curl -fsSL https://codeload.github.com/rameezimdad/baileys-api/tar.gz/master | tar xz --strip-components=1 -C /opt/baileys-api
```
```bash
pm2 restart baileys-api --update-env
```

Your `.env`, WhatsApp session, and keys are preserved.

## Daily commands

| What | Command |
|------|---------|
| Status | `pm2 status` |
| Logs | `pm2 logs baileys-api` |
| Restart | `pm2 restart baileys-api` |
| Health | `curl http://127.0.0.1:3000/healthz` |
| Forgot admin key | `grep ADMIN_API_KEY /opt/baileys-api/.env` |
| Change message gap | edit `MESSAGE_DELAY_MS` in `/opt/baileys-api/.env`, then restart |

Full step-by-step manual install, SSL via certbot, and troubleshooting: **[INSTALL.md](INSTALL.md)**
