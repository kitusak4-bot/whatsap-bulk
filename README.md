# Baileys WhatsApp API Server

Production-oriented REST API using Node.js, SQLite, and `baileys@7.0.0-rc13`.

Developed by Mohammad Rameez Imdad (Rameez Scripts)  
WhatsApp: https://wa.me/923224083545 (For Custom Projects)  
YouTube: https://www.youtube.com/@rameezimdad (Subscribe for more!)

## Important

Baileys uses WhatsApp Linked Devices and is not the official WhatsApp Business API. Use it only for lawful, consent-based messaging. Avoid spam and bulk unsolicited automation.

## Features

- **Web dashboard at `/`** — unlock with an API key, scan the WhatsApp QR, see live status, send a test message, and copy ready-made API examples for both your domain and the VPS IP
- **Send-only** — incoming messages are never processed or stored; there are no receive/webhook endpoints
- SQLite-backed Baileys credentials and Signal keys
- Automatic restart recovery and exponential reconnect
- Hashed, revocable API keys with `admin` and `api` roles
- QR as JSON data URL or PNG
- Text, image, document, audio, and location endpoints
- Multipart uploads with MIME and size validation
- Optional remote media with DNS/private-network SSRF checks
- Helmet, strict CORS, request validation, rate limits, and request IDs
- File logs plus SQLite request, connection, error, and delivery logs
- PM2 and Nginx production configuration

## Requirements

- Ubuntu 22.04/24.04
- Node.js 20 or newer
- Nginx and PM2
- Build tools for SQLite: `build-essential python3`

## Setup

```bash
sudo apt update
sudo apt install -y build-essential python3 nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2

cd "/opt/baileys-api"
cp .env.example .env
openssl rand -base64 48
openssl rand -base64 48
```

Put the two generated values into `ADMIN_API_KEY` and `API_KEY_PEPPER`. They must be different. Configure `CORS_ORIGINS` and keep `HOST=127.0.0.1` behind Nginx.

Keep `BAILEYS_LOG_LEVEL=warn` in production. Higher levels may include low-level WhatsApp protocol details.

```bash
npm ci --omit=dev
mkdir -p data logs
chmod 700 data logs
chmod 600 .env
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Run the command printed by `pm2 startup`, then run `pm2 save` again.

Install file-log rotation after confirming the project lives at `/opt/baileys-api`:

```bash
sudo cp deploy/logrotate-baileys-api /etc/logrotate.d/baileys-api
sudo logrotate -d /etc/logrotate.d/baileys-api
```

SQLite request/connection logs are pruned according to `LOG_RETENTION_DAYS`.

## Nginx and TLS

```bash
sudo cp nginx/baileys-api.conf /etc/nginx/sites-available/baileys-api
sudo sed -i 's/api.example.com/your-domain.example/g' /etc/nginx/sites-available/baileys-api
sudo ln -s /etc/nginx/sites-available/baileys-api /etc/nginx/sites-enabled/baileys-api
sudo nginx -t
sudo systemctl reload nginx

sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.example
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Keep the SQLite database and `.env` outside public web roots. Back up `data/baileys.sqlite` while the service is stopped or use SQLite's online backup command.

## Authentication

All `/api/*` requests require either:

```http
X-API-Key: your-key
```

or:

```http
Authorization: Bearer your-key
```

`ADMIN_API_KEY` is an environment-held bootstrap key accepted as an admin key. Use it to create stored keys, then use a stored admin key for routine administration. Rotate the bootstrap key in `.env` and restart PM2 if it is exposed.

Generate a key:

```bash
curl -X POST https://your-domain.example/api/admin/generate-key \
  -H "X-API-Key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"application-1","role":"api"}'
```

The raw generated key is returned once. SQLite stores only its prefix, random salt, and keyed hash.

```bash
curl https://your-domain.example/api/admin/list-keys \
  -H "X-API-Key: $ADMIN_API_KEY"

curl -X POST https://your-domain.example/api/admin/revoke-key \
  -H "X-API-Key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"id":"KEY_ID_OR_PREFIX"}'
```

## Dashboard

Open `https://your-domain.example/` (or `http://YOUR_VPS_IP/`) in a browser:

1. Enter your `ADMIN_API_KEY` (or any generated key) to unlock — the key stays in your browser only.
2. Scan the QR with WhatsApp (**Settings > Linked devices > Link a device**). The QR auto-refreshes.
3. Once connected, the page shows a test-send form plus two API sections: **Domain API** and **VPS IP API**, each with the base URL and a copyable curl example.

Set `PUBLIC_DOMAIN=your-domain.example` in `.env` so the Domain section always shows your domain. `PUBLIC_IP` is auto-detected; set it only to override. The server is send-only — incoming WhatsApp messages are ignored.

## WhatsApp Session

```bash
curl https://your-domain.example/api/status -H "X-API-Key: $API_KEY"

curl https://your-domain.example/api/qr -H "X-API-Key: $API_KEY"

curl "https://your-domain.example/api/qr?format=png" \
  -H "X-API-Key: $API_KEY" --output qr.png

curl -X POST https://your-domain.example/api/logout \
  -H "X-API-Key: $ADMIN_API_KEY"
```

Scan the QR from WhatsApp: **Settings > Linked devices > Link a device**. Credentials are stored in `whatsapp_auth`; the connection is restored after a restart.

## Messaging

Recipients must include the international country code, for example `923001234567`. Do not include a leading `+`. Group JIDs ending in `@g.us` are also accepted.

Text:

```bash
curl -X POST https://your-domain.example/api/send-message \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to":"923001234567","message":"Hello"}'
```

Image:

```bash
curl -X POST https://your-domain.example/api/send-image \
  -H "X-API-Key: $API_KEY" \
  -F "to=923001234567" \
  -F "caption=Invoice image" \
  -F "file=@./image.jpg"
```

Document:

```bash
curl -X POST https://your-domain.example/api/send-document \
  -H "X-API-Key: $API_KEY" \
  -F "to=923001234567" \
  -F "caption=Invoice" \
  -F "file=@./invoice.pdf"
```

Audio:

```bash
curl -X POST https://your-domain.example/api/send-audio \
  -H "X-API-Key: $API_KEY" \
  -F "to=923001234567" \
  -F "ptt=true" \
  -F "file=@./voice.ogg"
```

Location:

```bash
curl -X POST https://your-domain.example/api/send-location \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to":"923001234567","latitude":24.8607,"longitude":67.0011,"name":"Office","address":"Karachi"}'
```

Set `ALLOW_REMOTE_MEDIA=true` to send JSON payloads containing `url`. Multipart uploads are the safer default.

## Operations

```bash
pm2 status
pm2 logs baileys-api
pm2 restart baileys-api --update-env
curl http://127.0.0.1:3000/healthz
```

Only `/healthz` is unauthenticated; it exposes no account details. Every route under `/api` requires a valid key.

Use one PM2 instance. Multiple processes must not share one WhatsApp session or SQLite writer.
