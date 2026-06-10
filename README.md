# Baileys WhatsApp Send API

Developed by Mohammad Rameez Imdad (Rameez Scripts)
WhatsApp: https://wa.me/923224083545 (For Custom Projects)
YouTube: https://www.youtube.com/@rameezimdad (Subscribe for more!)

Send WhatsApp messages from any app with a simple HTTP call. Scan a QR once — done.
**Send-only** (incoming messages are ignored) with a built-in **anti-ban queue** (5.5s gap between messages).

---

## ⚡ Install — 3 steps

> Needs: a VPS with **Ubuntu 24.04** (or 22.04), logged in as `root`.
> Repo note: make this repo **Public** on GitHub before installing, set back to **Private** after.

**1.** Open the VPS terminal (Hostinger hPanel → your VPS → **Browser terminal**)

**2.** Paste this and press Enter:

```bash
curl -fsSLo i.sh https://raw.githubusercontent.com/rameezimdad/baileys-api/master/deploy/vps-install.sh && bash i.sh
```

**3.** Wait 3–5 min. It prints your **ADMIN API KEY** — copy and save it (shown only once).
Open `http://YOUR_VPS_IP/` → paste the key → scan the QR with WhatsApp (**Settings → Linked devices → Link a device**).

✅ That's it. The dashboard now shows a test-send form, an **API Keys** panel, and ready-made code examples.

**Reinstall from zero** (new key + new QR): same command but `bash i.sh --fresh`

## 🗑️ Delete old install (manual cleanup)

Run these one by one if you want to remove everything yourself:

```bash
pm2 delete baileys-api
```
```bash
rm -rf /opt/baileys-api ~/baileys-api ~/i.sh
```
```bash
rm -f /etc/nginx/sites-enabled/baileys-api /etc/nginx/sites-available/baileys-api
```
```bash
systemctl reload nginx
```

(`bash i.sh --fresh` does the same cleanup automatically before installing.)

---

## 📤 Send a message

```bash
curl -X POST http://YOUR_VPS_IP/api/send-message \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to":"923001234567","message":"Hello"}'
```

- Number = country code + number, **no `+`**
- Also: `/api/send-image`, `/api/send-document`, `/api/send-audio` (multipart field `file`), `/api/send-location`
- Bulk? Fire away — extra messages reply `"status":"queued"` instantly and send automatically, safely spaced
- Make one key per app from the dashboard's **API Keys** panel

## 🌐 Domain + HTTPS (optional)

1. Cloudflare → add domain → DNS: `A @ → VPS_IP` and `A www → VPS_IP`, both **Proxied 🟠**
2. Set Cloudflare's nameservers at your registrar
3. ⚠️ Cloudflare → **SSL/TLS → Overview → "Flexible"** (otherwise error 522)
4. On the VPS:

```bash
sed -i 's|^PUBLIC_DOMAIN=.*|PUBLIC_DOMAIN=yourdomain.com|' /opt/baileys-api/.env && pm2 restart baileys-api --update-env
```

## 🔄 Update to latest code

```bash
bash i.sh
```

(Same installer — it keeps your `.env`, API keys, and WhatsApp session. Repo must be Public for the moment.)

## 🛠️ Daily commands

| What | Command |
|------|---------|
| Status / logs | `pm2 status` · `pm2 logs baileys-api` |
| Restart | `pm2 restart baileys-api` |
| Forgot admin key | `grep ADMIN_API_KEY /opt/baileys-api/.env` |
| Message gap | `MESSAGE_DELAY_MS` in `/opt/baileys-api/.env` (then restart) |

Detailed manual install & troubleshooting: **[INSTALL.md](INSTALL.md)**
