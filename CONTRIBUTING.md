# Contributing

Thank you for your interest in contributing to Baileys WhatsApp Send API.

## Code of Conduct

By participating, you agree to uphold our [Code of Conduct](CODE_OF_CONDUCT.md).

## How to Contribute

1. **Fork** the repository.
2. **Create a branch** (`git checkout -b feature/your-feature`).
3. **Make your changes** following the existing code style.
4. **Write or update tests** as needed.
5. **Run tests** (`npm test`) — all must pass.
6. **Commit** with a clear, descriptive message.
7. **Push** and open a Pull Request.

## Development Setup

```bash
npm install
cp .env.example .env
# Edit .env with your ADMIN_API_KEY and API_KEY_PEPPER
npm run dev
```

## Project Structure

```
src/
  app.js          - Express app factory
  server.js       - Entry point
  config.js       - Zod-validated config
  logger.js       - Pino logger setup
  db/             - Database layer
  middleware/     - Auth, validation, error handling
  routes/         - API route handlers
  services/       - Business logic (WhatsApp, API keys, etc.)
  utils/          - Helpers
test/             - Tests (node:test + supertest)
campaigns/        - Campaign worker and data
public/           - Frontend SPA
```

## Rules

- **Do not modify** the WhatsApp send flow, Baileys connection, session persistence, or campaign worker execution.
- New features must be implemented as new modules, services, wrappers, or middleware.
- Prefer consuming existing APIs over changing them.
- Maintain backward compatibility.
- Keep the WhatsApp engine as a protected dependency.

## Pull Request Guidelines

- Keep PRs focused on a single concern.
- Include tests for new functionality.
- Update documentation if behavior changes.
- Ensure CI passes.

## Questions?

Open a GitHub Discussion or reach out via the channels in the README.
