/**
 * Developed by Mohammad Rameez Imdad (Rameez Scripts)
 * WhatsApp: https://wa.me/923224083545 (For Custom Projects)
 * YouTube: https://www.youtube.com/@rameezimdad (Subscribe for more!)
 */

import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

const schema = `
  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL UNIQUE,
    key_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'api')),
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    expires_at TEXT,
    revoked_at TEXT
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    wa_message_id TEXT UNIQUE,
    recipient TEXT NOT NULL,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    message_json TEXT,
    status TEXT NOT NULL,
    error TEXT,
    api_key_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL,
    category TEXT NOT NULL,
    event TEXT NOT NULL,
    request_id TEXT,
    api_key_id TEXT,
    context_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS whatsapp_auth (
    category TEXT NOT NULL,
    id TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (category, id)
  );

  CREATE INDEX IF NOT EXISTS idx_api_keys_prefix_active
    ON api_keys(key_prefix, revoked_at, expires_at);
  CREATE INDEX IF NOT EXISTS idx_messages_wa_id
    ON messages(wa_message_id);
  CREATE INDEX IF NOT EXISTS idx_messages_created
    ON messages(created_at);
  CREATE INDEX IF NOT EXISTS idx_logs_created
    ON logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_logs_category
    ON logs(category, created_at);

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS team_members (
    team_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'member', 'viewer')),
    invited_by TEXT,
    joined_at TEXT NOT NULL,
    PRIMARY KEY (team_id, user_id),
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    team_id TEXT,
    user_id TEXT,
    api_key_id TEXT,
    action TEXT NOT NULL,
    resource TEXT NOT NULL,
    resource_id TEXT,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_audit_logs_team ON audit_logs(team_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

  CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    stripe_price_id TEXT,
    monthly_limit INTEGER NOT NULL DEFAULT 0,
    team_members INTEGER NOT NULL DEFAULT 1,
    api_keys_limit INTEGER NOT NULL DEFAULT 1,
    features_json TEXT NOT NULL DEFAULT '[]',
    price_cents INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL UNIQUE,
    plan_id TEXT NOT NULL,
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    status TEXT NOT NULL DEFAULT 'inactive' CHECK(status IN ('active', 'inactive', 'past_due', 'canceled', 'trialing', 'incomplete')),
    current_period_start TEXT,
    current_period_end TEXT,
    trial_end TEXT,
    canceled_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (plan_id) REFERENCES plans(id)
  );

  CREATE TABLE IF NOT EXISTS usage_records (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    messages_sent INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_subscriptions_team ON subscriptions(team_id, status);
  CREATE INDEX IF NOT EXISTS idx_usage_records_team ON usage_records(team_id, period_start, period_end);

  CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '[]',
    secret TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY,
    webhook_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    event TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'delivered', 'failed')),
    response_code INTEGER,
    response_body TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_retry_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry ON webhook_deliveries(status, next_retry_at);
  CREATE INDEX IF NOT EXISTS idx_webhooks_team ON webhooks(team_id);

  CREATE TABLE IF NOT EXISTS scheduled_messages (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    api_key_id TEXT,
    recipient TEXT NOT NULL,
    message_type TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    scheduled_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed', 'canceled')),
    sent_at TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_scheduled_due ON scheduled_messages(status, scheduled_at);
  CREATE INDEX IF NOT EXISTS idx_scheduled_team ON scheduled_messages(team_id);

  CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    name TEXT NOT NULL,
    number TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS contact_groups (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS contact_group_members (
    group_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    PRIMARY KEY (group_id, contact_id),
    FOREIGN KEY (group_id) REFERENCES contact_groups(id) ON DELETE CASCADE,
    FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_contacts_team ON contacts(team_id, number);
  CREATE INDEX IF NOT EXISTS idx_contacts_tags ON contacts(team_id, tags);
  CREATE INDEX IF NOT EXISTS idx_contact_groups_team ON contact_groups(team_id);

  CREATE TABLE IF NOT EXISTS ab_tests (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    variants_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'running', 'completed', 'archived')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ab_test_results (
    id TEXT PRIMARY KEY,
    test_id TEXT NOT NULL,
    team_id TEXT NOT NULL,
    variant_index INTEGER NOT NULL,
    recipient TEXT NOT NULL,
    message_id TEXT,
    status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent', 'delivered', 'read', 'failed')),
    delivered_at TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (test_id) REFERENCES ab_tests(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_ab_tests_team ON ab_tests(team_id);
  CREATE INDEX IF NOT EXISTS idx_ab_test_results_test ON ab_test_results(test_id, variant_index);

  CREATE TABLE IF NOT EXISTS team_branding (
    team_id TEXT PRIMARY KEY,
    brand_name TEXT,
    logo_url TEXT,
    primary_color TEXT,
    secondary_color TEXT,
    favicon_url TEXT,
    custom_domain TEXT,
    support_email TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS job_queue (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    priority INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    error TEXT,
    result TEXT,
    next_retry_at TEXT,
    scheduled_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_job_queue_dequeue ON job_queue(status, scheduled_at, next_retry_at, priority, created_at);
  CREATE INDEX IF NOT EXISTS idx_job_queue_retry ON job_queue(status, next_retry_at);

  CREATE TABLE IF NOT EXISTS team_config (
    team_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (team_id, key)
  );

  CREATE TABLE IF NOT EXISTS rate_limit_windows (
    team_id TEXT NOT NULL,
    window_key TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (team_id, window_key)
  );

  CREATE INDEX IF NOT EXISTS idx_rate_limit_expires ON rate_limit_windows(expires_at);
`

const addColumnIfMissing = (db, table, column, definition) => {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column)
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

export { schema }

export const createDatabase = file => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.exec(schema)
  addColumnIfMissing(db, 'messages', 'message_json', 'TEXT')
  addColumnIfMissing(db, 'api_keys', 'user_id', 'TEXT REFERENCES users(id) ON DELETE SET NULL')
  addColumnIfMissing(db, 'api_keys', 'team_id', 'TEXT REFERENCES teams(id) ON DELETE SET NULL')
  addColumnIfMissing(db, 'api_keys', 'scopes', 'TEXT')
  addColumnIfMissing(db, 'messages', 'user_id', 'TEXT REFERENCES users(id) ON DELETE SET NULL')
  addColumnIfMissing(db, 'messages', 'team_id', 'TEXT REFERENCES teams(id) ON DELETE SET NULL')

  // Seed default plans if empty
  const planCount = db.prepare('SELECT COUNT(*) AS n FROM plans').get().n
  if (planCount === 0) {
    const now = new Date().toISOString()
    const insertPlan = db.prepare('INSERT INTO plans (id, name, stripe_price_id, monthly_limit, team_members, api_keys_limit, features_json, price_cents, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    insertPlan.run('free', 'Free', null, 50, 1, 1, JSON.stringify(['Send up to 50 msgs/mo', 'Single device', 'Basic support']), 0, 1, now)
    insertPlan.run('starter', 'Starter', null, 500, 3, 5, JSON.stringify(['Send up to 500 msgs/mo', 'Up to 3 team members', '5 API keys', 'Email support']), 999, 2, now)
    insertPlan.run('pro', 'Pro', null, 5000, 10, 20, JSON.stringify(['Send up to 5,000 msgs/mo', 'Up to 10 team members', '20 API keys', 'Priority support', 'Campaign analytics']), 2999, 3, now)
    insertPlan.run('enterprise', 'Enterprise', null, 50000, 100, 100, JSON.stringify(['Send up to 50,000 msgs/mo', 'Up to 100 team members', '100 API keys', 'Dedicated support', 'Custom integrations', 'SLA guarantee']), 9999, 4, now)
  }

  return db
}
