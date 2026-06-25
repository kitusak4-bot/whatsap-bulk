# whatsap-bulk

Production WhatsApp REST API with anti-ban protection, campaign dashboard, and real-time analytics.

[![CI](https://github.com/kitusak4-bot/whatsap-bulk/actions/workflows/ci.yml/badge.svg)](https://github.com/kitusak4-bot/whatsap-bulk/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](#license)

Send WhatsApp messages from any application with a single HTTP call. Scan a QR code once and start sending.

## Key Features

- **REST API** — send text, images, documents, audio, locations via HTTP
- **Anti-ban protection** — random 5-9s delays, typing simulation, burst pauses, daily limits
- **Campaign engine** — bulk send from CSV with progress tracking
- **Dashboard** — real-time status, message queue, analytics, contact management
- **API key auth** — admin and per-app keys with role-based access
- **Fire-and-forget** — messages queue automatically, no rate-limit worries

## Quick Start

### Docker (recommended)

```bash
git clone https://github.com/kitusak4-bot/whatsap-bulk.git
cd whatsap-bulk

# Generate secrets
echo "ADMIN_API_KEY=$(openssl rand -base64 48)" >> .env
echo "API_KEY_PEPPER=$(openssl rand -base64 48)" >> .env

docker compose up -d
```

Open `http://localhost:3000` → scan the QR code → start sending.

### Manual install

```bash
git clone https://github.com/kitusak4-bot/whatsap-bulk.git
cd whatsap-bulk
npm install
cp .env.example .env
# Edit .env — set ADMIN_API_KEY and API_KEY_PEPPER (min 32 chars each)
node src/server.js
```

## API Overview

All endpoints require the `X-API-Key` header.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/send-message` | Send a text message |
| POST | `/api/send-image` | Send an image (URL or upload) |
| POST | `/api/send-document` | Send a PDF, Office doc, zip |
| POST | `/api/send-audio` | Send audio / voice note |
| POST | `/api/send-location` | Send a location pin |
| GET | `/api/status` | Connection + queue status |
| GET | `/api/messages` | Message queue + history |
| GET | `/api/me` | Your API key info |
| GET | `/api/qr` | QR code for WhatsApp linking |
| GET | `/api/server-info` | Server domain / IP info |
| POST | `/api/logout` | Unlink WhatsApp session (admin) |
| POST | `/api/admin/generate-key` | Create a new API key (admin) |
| POST | `/api/admin/revoke-key` | Revoke an API key (admin) |
| GET | `/api/admin/list-keys` | List all keys (admin) |

### Example: send a message

```bash
curl -X POST http://localhost:3000/api/send-message \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to":"923001234567","message":"Hello from API"}'
```

Response:
```json
{
  "success": true,
  "data": { "status": "sent", "id": "msg_abc123" }
}
```

## Architecture

```
┌─────────────────────────────────────────────┐
│  Port 3000 — Main API + Dashboard           │
│  ├── Express + Baileys (WhatsApp Web)       │
│  ├── SQLite (messages, keys, logs)          │
│  ├── Anti-ban queue (p-queue)               │
│  └── Static dashboard (public/index.html)   │
├─────────────────────────────────────────────┤
│  Port 4000 — Campaign Dashboard (optional)  │
│  ├── Bulk campaign launcher                 │
│  ├── Campaign reports                       │
│  └── Separate auth system                   │
└─────────────────────────────────────────────┘
```

## Configuration

All settings are in `.env`. Key options:

| Variable | Default | Description |
|----------|---------|-------------|
| `MESSAGE_DELAY_MIN_MS` | 5000 | Min gap between messages |
| `MESSAGE_DELAY_MAX_MS` | 9000 | Max gap between messages |
| `TYPING_SIMULATION` | true | Show "typing..." before sends |
| `BURST_SIZE` | 20 | Messages before a long pause |
| `DAILY_SEND_LIMIT` | 500 | Max messages per day (UTC) |
| `CHECK_RECIPIENT_EXISTS` | true | Verify number is on WhatsApp |

## Deployment

### VPS (Ubuntu)

```bash
curl -fsSLo i.sh https://raw.githubusercontent.com/kitusak4-bot/whatsap-bulk/master/deploy/vps-install.sh && bash i.sh
```

### Update

```bash
curl -fsSLo u.sh https://raw.githubusercontent.com/kitusak4-bot/whatsap-bulk/master/deploy/vps-update.sh && bash u.sh
```

## Project Structure

```
├── src/                  # Main API server
│   ├── server.js         # Entry point
│   ├── app.js            # Express app setup
│   ├── config.js         # Zod-validated env config
│   ├── routes/           # API routes
│   ├── services/         # Business logic
│   ├── middleware/        # Auth, validation, error handling
│   └── db/               # SQLite database
├── public/               # Dashboard frontend
│   └── index.html        # Single-file SPA
├── dashboard/            # Campaign dashboard (port 4000)
├── campaigns/            # Campaign worker + reports
├── deploy/               # VPS install/update scripts
├── test/                 # Test suite
├── Dockerfile            # Container build
└── docker-compose.yml    # Multi-service orchestration
```

## License

MIT
