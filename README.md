# Baileys WhatsApp Send API

**Production-ready WhatsApp REST API** with anti-ban protection, message queuing, campaign management, and Docker support.

Send text, images, documents, audio, and location messages from any app with a simple HTTP call. Scan a QR once — done.

Developed by [Mohammad Rameez Imdad](https://www.youtube.com/@rameezimdad) (Rameez Scripts)

[![CI](https://github.com/rameezimdad/baileys-api/actions/workflows/ci.yml/badge.svg)](https://github.com/rameezimdad/baileys-api/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)

---

## 📋 Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Docker Deployment](#docker-deployment)
- [API Reference](#api-reference)
- [Dashboard](#dashboard)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

---

## ✨ Features

| Feature | Description |
|---|---|
| **Simple REST API** | Send text, images, documents, audio, and locations via HTTP |
| **Anti-Ban Protection** | Random 5–9s delays, typing simulation, burst cool-downs, daily limits |
| **Bulk Campaigns** | Upload CSV contacts, send with safe spacing |
| **API Key Auth** | HMAC-hashed keys with admin/user roles |
| **Message Queuing** | Fire-and-forget — extra messages queue and send automatically |
| **Recipient Verification** | Checks number is on WhatsApp before sending |
| **Docker Support** | One-command deploy with persistent volumes |
| **Analytics Dashboard** | Real-time status, message history, campaign reports |
| **Google Sheets Integration** | Use from Apps Script — see [`clients/apps-script`](./clients/apps-script) |
| **Swagger/OpenAPI** | Interactive API docs at `/api/docs` |
| **Error Tracking** | Optional Sentry integration |
| **Product Analytics** | Optional PostHog integration |

---

## ⚡ Quick Start

### Option 1: Docker (Recommended)

```bash
# Clone the repo
git clone https://github.com/rameezimdad/baileys-api.git
cd baileys-api

# Create .env with your keys
cp .env.example .env
# Edit .env — set ADMIN_API_KEY and API_KEY_PEPPER (min 32 chars each)

# Start with Docker Compose
docker compose up -d

# Open the dashboard
open http://localhost:3000/dashboard
```

### Option 2: VPS Install (Ubuntu 24.04/22.04)

> Needs: a VPS with **Ubuntu 24.04** (or 22.04), logged in as `root`.

```bash
curl -fsSLo i.sh https://raw.githubusercontent.com/rameezimdad/baileys-api/master/deploy/vps-install.sh && bash i.sh
```

Wait 3–5 min. It prints your **ADMIN API KEY** — copy and save it. Open `http://YOUR_VPS_IP/` → paste the key → scan the QR with WhatsApp.

### Option 3: Node.js (Development)

```bash
npm install
cp .env.example .env
# Edit .env — set ADMIN_API_KEY and API_KEY_PEPPER
npm run dev
```

---

## 🐳 Docker Deployment

```bash
# Build and start
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down

# Full reset (destroys data)
docker compose down -v
```

**Environment variables** are passed via `docker-compose.yml` or a `.env` file in the project root. Volume mounts persist data, logs, and campaign files.

### Docker Compose Configuration

```yaml
# docker-compose.yml (included in repo)
services:
  app:
    build: .
    ports:
      - "${PORT:-3000}:3000"
    volumes:
      - baileys_data:/app/data
      - baileys_logs:/app/logs
      - baileys_campaigns:/app/campaigns
    environment:
      - ADMIN_API_KEY=${ADMIN_API_KEY:?required}
      - API_KEY_PEPPER=${API_KEY_PEPPER:?required}
```

---

## 📡 API Reference

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/healthz` | Public | Health check |
| `GET` | `/api/status` | API Key | WhatsApp connection status |
| `GET` | `/api/qr` | API Key | QR code (JSON or `?format=png`) |
| `POST` | `/api/logout` | Admin | Logout WhatsApp session |
| `POST` | `/api/send-message` | API Key | Send text message |
| `POST` | `/api/send-image` | API Key | Send image (multipart) |
| `POST` | `/api/send-document` | API Key | Send document (multipart) |
| `POST` | `/api/send-audio` | API Key | Send audio/voice note |
| `POST` | `/api/send-location` | API Key | Send location pin |
| `GET` | `/api/messages` | API Key | Message queue/history |
| `GET` | `/api/campaigns/recent` | API Key | Recent campaign reports |
| `GET` | `/api/me` | API Key | Current key info |
| `GET` | `/api/server-info` | API Key | Server details |
| `POST` | `/api/admin/generate-key` | Admin | Create API key |
| `POST` | `/api/admin/revoke-key` | Admin | Revoke API key |
| `GET` | `/api/admin/list-keys` | Admin | List API keys |
| `GET` | `/api/docs` | - | Interactive Swagger docs |
| `GET` | `/api/docs.json` | - | OpenAPI spec |

### Authentication

Pass your API key via the `X-API-Key` header or `Authorization: Bearer <key>`:

```bash
curl -X POST /api/send-message \
  -H "X-API-Key: wapi_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{"to":"923001234567","message":"Hello"}'
```

### Sending Messages

```bash
# Text
curl -X POST http://localhost:3000/api/send-message \
  -H "X-API-Key: wapi_key" \
  -d '{"to":"923001234567","message":"Hello"}'

# Image
curl -X POST http://localhost:3000/api/send-image \
  -H "X-API-Key: wapi_key" \
  -F "to=923001234567" -F "file=@photo.jpg" -F "caption=Nice!"

# Location
curl -X POST http://localhost:3000/api/send-location \
  -H "X-API-Key: wapi_key" \
  -d '{"to":"923001234567","latitude":24.8607,"longitude":67.0011}'
```

### Anti-Ban Parameters

| Variable | Default | Description |
|---|---|---|
| `MESSAGE_DELAY_MIN_MS` | 5000 | Minimum gap between messages |
| `MESSAGE_DELAY_MAX_MS` | 9000 | Maximum gap between messages |
| `TYPING_SIMULATION` | true | Show "typing..." before each send |
| `BURST_SIZE` | 20 | Messages before burst cool-down |
| `BURST_PAUSE_MIN_MS` | 30000 | Minimum burst pause |
| `BURST_PAUSE_MAX_MS` | 60000 | Maximum burst pause |
| `DAILY_SEND_LIMIT` | 500 | Messages per day (0 = unlimited) |

All configurable in `.env`.

---

## 🖥️ Dashboard

Access the SPA dashboard at `/dashboard` after deploying:

```
http://localhost:3000/dashboard
```

Features:
- WhatsApp connection status with auto-polling
- QR code display with countdown
- Test message send form
- Message queue with status filters
- Campaign creation (CSV upload + message template)
- Campaign reports with analytics
- API key management
- Message templates (localStorage)
- Contacts management
- 7-day activity chart
- Dark mode

Requires an API key to unlock.

---

## 📚 Documentation

- **Swagger UI**: [`/api/docs`](http://localhost:3000/api/docs) — interactive API reference
- **OpenAPI Spec**: [`/api/docs.json`](http://localhost:3000/api/docs.json) — raw JSON spec
- **Install Guide**: [`INSTALL.md`](INSTALL.md)
- **Apps Script Client**: [`clients/apps-script/`](./clients/apps-script)
- **Contributing**: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- **Code of Conduct**: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)

---

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. Key rules:

- **Do not modify** the WhatsApp send flow, Baileys connection, or session persistence
- New features must be new modules, services, wrappers, or middleware
- Maintain backward compatibility

---

## 🛠️ Daily Commands

```bash
# PM2
pm2 status                    # Process status
pm2 logs baileys-api           # View logs
pm2 restart baileys-api        # Restart

# Docker
docker compose logs -f         # View logs
docker compose restart         # Restart
docker compose down            # Stop

# Environment
grep ADMIN_API_KEY .env        # Find admin key
```

---

## 📄 License

MIT License — see [LICENSE](LICENSE).

---

## 🙋 Support

- **YouTube**: [@rameezimdad](https://www.youtube.com/@rameezimdad)
- **WhatsApp**: [Chat](https://wa.me/923224083545)
- **GitHub Issues**: [Create an issue](https://github.com/rameezimdad/baileys-api/issues)
