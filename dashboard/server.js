/**
 * WhatsApp Campaign SaaS — Premium Dashboard Server
 *
 *   PORT=4000 node dashboard/server.js
 *
 * This is a self-contained Express dashboard with its own auth system.
 * It does NOT modify the main API server, Baileys, worker.js, or database.
 */

import express from "express";
import fs from "fs";
import multer from "multer";
import path from "path";
import { randomUUID } from "node:crypto";
import { spawn } from "child_process";

/* ── configuration ── */
const PORT = parseInt(process.env.DASHBOARD_PORT, 10) || 4000;
const CAMPAIGNS_DIR = path.resolve("./campaigns");
const AUTH_DIR = path.resolve("./auth");

/* ── auth system (in-memory, no database) ── */
const ADMIN_USER = process.env.DASHBOARD_USER || "admin";
const ADMIN_PASS = process.env.DASHBOARD_PASS || "admin123";
const SESSION_COOKIE = "dash_session";
const sessions = new Map(); // token → { username, createdAt }

const parseCookies = (req) => {
  const cookie = req.headers.cookie || "";
  const result = {};
  cookie.split(";").forEach((pair) => {
    const [k, ...v] = pair.trim().split("=");
    if (k) result[k.trim()] = v.join("=");
  });
  return result;
};

/* ── express setup ── */
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const upload = multer({ dest: "campaigns/" });

/* ── auth helpers ── */
const isAuthenticated = (req) => {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  return token && sessions.has(token) ? sessions.get(token) : null;
};

const requireAuth = (req, res, next) => {
  const session = isAuthenticated(req);
  if (!session) {
    if (req.accepts("html")) return res.redirect("/auth/login");
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  req.session = session;
  next();
};

/* ── campaign data helpers ── */
const getCampaignReports = () => {
  try {
    return fs
      .readdirSync(CAMPAIGNS_DIR)
      .filter((f) => f.startsWith("campaign-") && f.endsWith(".json"))
      .map((name) => {
        const mtime = fs.statSync(path.join(CAMPAIGNS_DIR, name)).mtimeMs;
        let data = null;
        try {
          data = JSON.parse(fs.readFileSync(path.join(CAMPAIGNS_DIR, name), "utf-8"));
        } catch {
          /* skip unparseable */
        }
        return { name, mtime, data };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
};

const getReportByName = (fileName) => {
  const safe = path.basename(fileName);
  const full = path.join(CAMPAIGNS_DIR, safe);
  if (!safe.startsWith("campaign-") || !safe.endsWith(".json") || !fs.existsSync(full)) return null;
  try {
    const raw = fs.readFileSync(full, "utf-8");
    return { name: safe, data: JSON.parse(raw) };
  } catch {
    return null;
  }
};

const computeStats = (reports) => {
  let totalCampaigns = reports.length;
  let totalSent = 0;
  let totalFailed = 0;
  let totalMessages = 0;
  reports.forEach((r) => {
    if (r.data) {
      totalSent += r.data.success || 0;
      totalFailed += r.data.failed || 0;
      totalMessages += r.data.total || 0;
    }
  });
  const successRate = totalMessages > 0 ? Math.round((totalSent / totalMessages) * 100) : 0;
  return { totalCampaigns, totalSent, totalFailed, totalMessages, successRate };
};

const timeAgo = (ts) => {
  if (!ts) return "—";
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
};

const formatTime = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
};

/* ═══════════════════════════════════════════════
   ROUTES — auth
   ═══════════════════════════════════════════════ */

app.get("/auth/login", (req, res) => {
  // If already logged in, redirect to dashboard
  if (isAuthenticated(req)) return res.redirect("/");
  try {
    const html = fs.readFileSync(path.join(AUTH_DIR, "login.html"), "utf-8");
    res.type("html").send(html);
  } catch {
    // Fallback inline login page if file is missing
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Sign In</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f5f6fa}form{background:#fff;padding:32px;border-radius:16px;box-shadow:0 8px 24px rgba(0,0,0,.06);max-width:360px;width:100%}h1{color:#111844;margin-bottom:24px}label{display:block;font-size:13px;font-weight:600;color:#111844;margin-bottom:6px}input{width:100%;padding:10px 12px;border:1.5px solid #e2e5ef;border-radius:8px;margin-bottom:16px;font-size:14px}button{width:100%;padding:11px;background:#111844;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer}button:hover{background:#1a2456}.err{color:#dc2626;font-size:13px;margin-bottom:12px;display:none}</style></head><body><form method="POST" action="/auth/login"><h1>Sign In</h1><div class="err" id="err"></div><label>Username</label><input type="text" name="username" required><label>Password</label><input type="password" name="password" required><button type="submit">Sign In</button></form><script>if(location.search.includes('error'))document.getElementById('err').style.display='block'</script></body></html>`);
  }
});

app.post("/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    const token = randomUUID();
    sessions.set(token, { username, createdAt: Date.now() });
    res.set(
      "Set-Cookie",
      `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${86400 * 7}`
    );
    return res.json({ success: true });
  }
  res.status(401).json({ success: false, error: "Invalid username or password" });
});

app.post("/auth/logout", requireAuth, (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (token) sessions.delete(token);
  res.set("Set-Cookie", `${SESSION_COOKIE}=; Path=/; Max-Age=0`);
  res.json({ success: true });
});

/* ═══════════════════════════════════════════════
   ROUTES — API (protected)
   ═══════════════════════════════════════════════ */

app.get("/api/campaigns/recent", requireAuth, (req, res) => {
  const reports = getCampaignReports();
  const stats = computeStats(reports);
  const list = reports.slice(0, 20).map((r) => ({
    file: r.name,
    campaign: r.data?.campaign || null,
    time: r.data?.time || null,
    total: r.data?.total ?? null,
    success: r.data?.success ?? null,
    failed: r.data?.failed ?? null,
    resultsCount: r.data?.results?.length ?? null,
  }));
  res.json({ success: true, data: { totalCampaigns: stats.totalCampaigns, reports: list } });
});

/* ═══════════════════════════════════════════════
   ROUTES — Pages (protected)
   ═══════════════════════════════════════════════ */

app.get(["/", "/dashboard", "/reports", "/report/:name"], requireAuth, (req, res, next) => {
  const reports = getCampaignReports();
  const stats = computeStats(reports);
  const last5 = reports.slice(0, 5);
  const username = req.session?.username || "Admin";

  // Single report detail
  if (req.params?.name) {
    const report = getReportByName(req.params.name);
    if (!report) return next();
    return renderReportDetail(req, res, report, username, reports.length);
  }

  // Reports list page
  if (req.path === "/reports" || req.path.startsWith("/reports")) {
    return renderReports(req, res, reports, username);
  }

  // Dashboard home
  renderDashboard(req, res, stats, last5, reports, username);
});

/* ── helpers ── */
function renderDashboard(req, res, stats, last5, reports, username) {
  const campaignCards = last5
    .map((r, i) => {
      const ok = r.data?.success ?? 0;
      const fail = r.data?.failed ?? 0;
      const total = r.data?.total ?? ok + fail;
      const pct = total > 0 ? Math.round((ok / total) * 100) : 0;
      const barColor = pct >= 80 ? "#1f9d55" : pct >= 50 ? "#d68910" : "#dc2626";
      const name = r.data?.campaign || "Unnamed Campaign";
      return `
      <a href="/report/${encodeURIComponent(r.name)}" class="camp-card">
        <div class="camp-card-head">
          <span class="camp-name">${escHtml(name)}</span>
          <span class="camp-file">${escHtml(r.name)}</span>
        </div>
        <div class="camp-card-stats">
          <div class="cc-stat"><span class="cc-num ok">${ok}</span> sent</div>
          <div class="cc-stat"><span class="cc-num fail">${fail}</span> failed</div>
          <div class="cc-bar"><div class="cc-fill" style="width:${pct}%;background:${barColor}"></div></div>
        </div>
        <div class="camp-card-foot">${timeAgo(r.mtime)} · ${pct}% success rate</div>
      </a>`;
    })
    .join("");

  const allTimeSent = stats.totalCampaigns > 0
    ? `<div class="stat-cards">
         <div class="stat-card"><div class="stat-num">${stats.totalCampaigns}</div><div class="stat-label">Total Campaigns</div></div>
         <div class="stat-card"><div class="stat-num" style="color:#1f9d55">${stats.totalSent}</div><div class="stat-label">Messages Sent</div></div>
         <div class="stat-card"><div class="stat-num" style="color:#dc2626">${stats.totalFailed}</div><div class="stat-label">Failed</div></div>
         <div class="stat-card"><div class="stat-num" style="color:#111844">${stats.successRate}%</div><div class="stat-label">Success Rate</div></div>
       </div>`
    : `<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="#d1d5db"><path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2zm0 14H4V4h16v12zM6 6h12v2H6zm0 4h8v2H6z"/></svg><h3>No campaigns yet</h3><p>Launch your first campaign from the Campaigns page.</p></div>`;

  const activePage = "dashboard";

  res.send(renderLayout(
    "Dashboard",
    activePage,
    username,
    `
    <div class="page-header">
      <h2>Dashboard</h2>
      <p class="page-sub">Campaign performance at a glance</p>
    </div>
    ${allTimeSent}
    <div class="section-head">
      <h3>Recent Campaigns</h3>
      <a href="/reports" class="link">View all →</a>
    </div>
    <div class="camp-cards">${campaignCards || '<p style="color:#6b7280;padding:12px 0">No campaigns yet.</p>'}</div>
    `
  ));
}

function renderReports(req, res, reports, username) {
  const rows = reports
    .map((r, i) => {
      const ok = r.data?.success ?? 0;
      const fail = r.data?.failed ?? 0;
      const total = r.data?.total ?? ok + fail;
      const pct = total > 0 ? Math.round((ok / total) * 100) : 0;
      const barColor = pct >= 80 ? "#1f9d55" : pct >= 50 ? "#d68910" : "#dc2626";
      return `
      <tr>
        <td>${i + 1}</td>
        <td><code>${escHtml(r.name)}</code></td>
        <td>${escHtml(r.data?.campaign || "—")}</td>
        <td><span style="color:#1f9d55;font-weight:600">${ok}</span> / <span style="color:#dc2626;font-weight:600">${fail}</span></td>
        <td><div class="bar-sm"><div class="bar-fill-sm" style="width:${pct}%;background:${barColor}"></div></div><span style="font-size:11px;color:#6b7280;margin-left:8px">${pct}%</span></td>
        <td style="color:#6b7280;font-size:12px">${formatTime(r.data?.time)}</td>
        <td><a href="/report/${encodeURIComponent(r.name)}" class="btn-sm">View</a></td>
      </tr>`;
    })
    .join("");

  const content = reports.length
    ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>File</th><th>Campaign</th><th>Sent/Failed</th><th>Rate</th><th>Date</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
    : `<div class="empty-state"><h3>No reports yet</h3><p>Campaign reports will appear here after you launch one.</p></div>`;

  res.send(renderLayout(
    "Campaign Reports",
    "reports",
    username,
    `
    <div class="page-header">
      <h2>Campaign Reports</h2>
      <p class="page-sub">${reports.length} campaign${reports.length !== 1 ? "s" : ""} total</p>
    </div>
    ${content}
    `
  ));
}

function renderReportDetail(req, res, report, username, totalCampaigns) {
  const d = report.data;
  const ok = d?.success ?? 0;
  const fail = d?.failed ?? 0;
  const total = d?.total ?? ok + fail;
  const pct = total > 0 ? Math.round((ok / total) * 100) : 0;
  const barColor = pct >= 80 ? "#1f9d55" : pct >= 50 ? "#d68910" : "#dc2626";

  const resultsRows = Array.isArray(d?.results)
    ? d.results
        .map(
          (r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><code>${escHtml(r.number || "—")}</code></td>
        <td><span class="badge ${r.status === "sent" ? "badge-ok" : "badge-fail"}">${escHtml(r.status || "?")}</span></td>
        <td style="color:#6b7280;font-size:12px">${escHtml(r.error || r.waMessageId || "—")}</td>
      </tr>`
        )
        .join("")
    : "";

  const content = `
    <div class="page-header">
      <a href="/reports" class="back-link">← Back to Reports</a>
      <h2>${escHtml(d?.campaign || "Campaign Report")}</h2>
      <p class="page-sub">${escHtml(report.name)} · ${formatTime(d?.time)}</p>
    </div>

    <div class="stat-cards" style="margin-bottom:24px">
      <div class="stat-card"><div class="stat-num">${total}</div><div class="stat-label">Total Messages</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#1f9d55">${ok}</div><div class="stat-label">Sent</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#dc2626">${fail}</div><div class="stat-label">Failed</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#111844">${pct}%</div><div class="stat-label">Success Rate</div>
        <div class="bar-sm" style="margin-top:6px;width:100%"><div class="bar-fill-sm" style="width:${pct}%;background:${barColor}"></div></div>
      </div>
    </div>

    ${
      resultsRows
        ? `<div class="section-head"><h3>Individual Results (${d.results.length})</h3></div>
       <div class="table-wrap"><table class="data-table">
         <thead><tr><th>#</th><th>Number</th><th>Status</th><th>Details</th></tr></thead>
         <tbody>${resultsRows}</tbody>
       </table></div>`
        : `<div class="empty-state"><h3>No results data</h3><p>This report does not contain individual message results.</p></div>`
    }
  `;

  res.send(renderLayout("Report Details", "reports", username, content));
}

/* ═══════════════════════════════════════════════
   ROUTES — Settings
   ═══════════════════════════════════════════════ */

app.get("/settings", requireAuth, (req, res) => {
  const username = req.session?.username || "Admin";
  res.send(renderLayout(
    "Settings",
    "settings",
    username,
    `
    <div class="page-header">
      <h2>Settings</h2>
      <p class="page-sub">Dashboard preferences and account</p>
    </div>
    <div class="form-card" style="max-width:500px">
      <div style="margin-bottom:20px">
        <div style="font-size:14px;font-weight:600;color:#111844;margin-bottom:4px">Account</div>
        <div style="font-size:13px;color:#6b7280">Signed in as <strong>${escHtml(username)}</strong></div>
        <div style="font-size:13px;color:#6b7280;margin-top:2px">Dashboard session expires after 7 days of inactivity.</div>
      </div>
      <div class="field">
        <label>Dashboard Port</label>
        <input type="text" value="${PORT}" readonly style="background:#f9fafb;color:#6b7280" />
      </div>
      <div class="field">
        <label>Campaigns Directory</label>
        <input type="text" value="${escHtml(CAMPAIGNS_DIR)}" readonly style="background:#f9fafb;color:#6b7280" />
      </div>
      <div style="border-top:1px solid #e5e7eb;padding-top:18px;margin-top:6px">
        <div style="font-size:13px;color:#6b7280;line-height:1.6">
          <strong style="color:#111844">WhatsApp Campaign SaaS</strong><br>
          Uses the main Baileys API (port 3000) for WhatsApp messaging.<br>
          Campaign workers run as child processes with anti-ban delays.
        </div>
      </div>
    </div>
    `
  ));
});

/* ═══════════════════════════════════════════════
   ROUTES — Campaign Launch (preserved from original)
   ═══════════════════════════════════════════════ */

app.get("/campaigns", requireAuth, (req, res) => {
  const username = req.session?.username || "Admin";
  const reports = getCampaignReports();

  res.send(renderLayout(
    "Launch Campaign",
    "campaigns",
    username,
    `
    <div class="page-header">
      <h2>Launch Campaign</h2>
      <p class="page-sub">Send bulk WhatsApp messages with anti-ban protection</p>
    </div>

    <div class="form-card">
      <form action="/start" method="POST" enctype="multipart/form-data">
        <div class="field">
          <label>Campaign Name</label>
          <input type="text" name="name" placeholder="e.g. Product Launch Q3" required />
        </div>
        <div class="field">
          <label>Message <span class="hint">(use {name} as recipient placeholder)</span></label>
          <textarea name="message" rows="4" placeholder="Hello {name}, check out our latest offers!" required></textarea>
        </div>
        <div class="field-row">
          <div class="field">
            <label>Delay Min (ms)</label>
            <input type="number" name="delayMin" value="5000" min="1000" step="500" />
          </div>
          <div class="field">
            <label>Delay Max (ms)</label>
            <input type="number" name="delayMax" value="8000" min="2000" step="500" />
          </div>
        </div>
        <div class="field">
          <label>Contacts CSV <span class="hint">(columns: number, name)</span></label>
          <input type="file" name="file" accept=".csv" required style="padding:8px 0" />
        </div>
        <div class="note-box">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#d68910"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
          <span>Messages send one-by-one with random 5-9s anti-ban delay. Do not stop the worker mid-campaign.</span>
        </div>
        <button class="btn btn-primary" type="submit">🚀 Start Campaign</button>
      </form>
    </div>
    `
  ));
});

app.post("/start", requireAuth, upload.single("file"), (req, res) => {
  const { name, message, delayMin, delayMax } = req.body;

  const config = { name, message, delayMin: Number(delayMin), delayMax: Number(delayMax) };
  fs.writeFileSync(path.join(CAMPAIGNS_DIR, "campaign.json"), JSON.stringify(config, null, 2));

  if (req.file) {
    const dest = path.join(CAMPAIGNS_DIR, "contacts.csv");
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    fs.renameSync(req.file.path, dest);
  }

  const proc = spawn("node", ["campaigns/worker.js"], { cwd: path.resolve("."), stdio: "pipe" });
  proc.stdout.on("data", (d) => console.log(`[WORKER] ${d}`));
  proc.stderr.on("data", (d) => console.error(`[ERROR] ${d}`));

  res.send(`
    <!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="refresh" content="2;url=/campaigns"><title>Campaign Started</title>
    <style>body{font-family:'Segoe UI',sans-serif;background:#f5f6fa;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
    .box{background:#fff;padding:32px 40px;border-radius:16px;box-shadow:0 8px 24px rgba(0,0,0,.04);text-align:center;max-width:420px}
    h2{color:#111844;margin-bottom:8px}p{color:#6b7280;font-size:14px}a{color:#111844}</style></head>
    <body><div class="box"><h2>✅ Campaign Started</h2><p>${escHtml(name)} is now sending. Check the terminal for live logs.</p><p style="margin-top:16px"><a href="/campaigns">← Back to Campaigns</a></p></div></body></html>
  `);
});

/* ═══════════════════════════════════════════════
   LAYOUT RENDERER
   ═══════════════════════════════════════════════ */

function renderLayout(pageTitle, activePage, username, content) {
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>` },
    { id: "campaigns", label: "Campaigns", icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4V4c0-1.1-.9-2-2-2zm0 14H4V4h16v12zM6 6h12v2H6zm0 4h8v2H6z"/></svg>` },
    { id: "reports", label: "Reports", icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 10h2v7H7zm4-3h2v10h-2zm4 6h2v4h-2z"/></svg>` },
    { id: "settings", label: "Settings", icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1115.6 12 3.611 3.611 0 0112 15.6z"/></svg>` },
  ];

  const navHtml = navItems
    .map(
      (n) => `
      <a href="/${n.id === "dashboard" ? "" : n.id}" class="nav-item ${activePage === n.id ? "active" : ""}">
        ${n.icon}
        <span>${n.label}</span>
      </a>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#121358">
<title>${escHtml(pageTitle)} — WhatsApp Campaign SaaS</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>💬</text></svg>">
<style>
  :root {
    --bg: #f5f6fa;
    --ink: #1a1a2e;
    --muted: #6b7280;
    --line: #e5e7eb;
    --card-bg: #ffffff;
    --input-bg: #fafbff;
    --navy: #121358;
    --navy-hover: #0e0f46;
    --green: #1f9d55;
    --red: #dc2626;
    --amber: #d68910;
    --bg-dot: rgba(18,19,88,.04);
    --scrollbar-thumb: #d1d5db;
    --sb-bg: #121358;
    --topbar-bg: #ffffff;
    --table-hover: #f9fafb;
    --input-border: #e2e5ef;
  }
  body.dark {
    --bg: #0a1118;
    --ink: #e1e8f0;
    --muted: #8899aa;
    --line: #2a3a4a;
    --card-bg: #111d2b;
    --input-bg: #152233;
    --navy: #121358;
    --navy-hover: #0e0f46;
    --green: #2ecc71;
    --red: #e74c3c;
    --amber: #f0b429;
    --bg-dot: transparent;
    --scrollbar-thumb: #2a3a4a;
    --sb-bg: #121358;
    --topbar-bg: #0d1b2a;
    --table-hover: #152233;
    --input-border: #2a3a4a;
  }
  * { margin:0; padding:0; box-sizing:border-box }
  body {
    font-family:'Inter','Segoe UI',system-ui,sans-serif;
    background: var(--bg);
    color: var(--ink);
    display:flex; min-height:100vh;
    transition: background .3s, color .3s;
  }
  a { text-decoration:none; color:inherit }

  /* ── scrollbar ── */
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 999px; }
  * { scrollbar-width: thin; scrollbar-color: var(--scrollbar-thumb) transparent; }

  /* ── dark toggle ── */
  #darkToggle {
    background: none; border: 1px solid var(--line); border-radius: 7px;
    width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;
    cursor: pointer; color: var(--ink); font-size: 15px;
    transition: background .15s, color .15s;
    flex-shrink: 0;
  }
  #darkToggle:hover { background: var(--line); }

  /* ── sidebar ── */
  .sidebar { width:240px; background:var(--sb-bg); color:#fff; display:flex; flex-direction:column; flex-shrink:0; position:fixed; inset:0 auto 0 0; z-index:100; transition: background .3s; }
  .sb-brand { padding:20px 18px; border-bottom:1px solid rgba(255,255,255,.08); display:flex; align-items:center; gap:10px }
  .sb-brand .logo {
    width:34px; height:34px;
    background: var(--navy);
    border-radius:9px;
    display:flex; align-items:center; justify-content:center; flex-shrink:0;
    box-shadow: 0 2px 8px rgba(37,211,102,.25);
  }
  .sb-brand .logo svg { width:20px; height:20px; fill:#fff }
  .sb-brand .t { min-width:0 }
  .sb-brand .t strong { display:block; font-size:14px; font-weight:700; letter-spacing:-.2px }
  .sb-brand .t small { font-size:10.5px; color:rgba(255,255,255,.5) }
  .sb-nav { flex:1; padding:12px 10px; display:flex; flex-direction:column; gap:2px }
  .nav-item { display:flex; align-items:center; gap:11px; padding:10px 12px; border-radius:8px; font-size:13.5px; font-weight:500; color:rgba(255,255,255,.65); transition:all .12s }
  .nav-item:hover { background:rgba(255,255,255,.08); color:#fff }
  .nav-item.active { background:rgba(255,255,255,.12); color:#fff; font-weight:600 }
  .sb-foot { padding:14px 14px; border-top:1px solid rgba(255,255,255,.08); font-size:12px; color:rgba(255,255,255,.45); transition: background .3s; }
  .sb-foot .user { display:flex; align-items:center; gap:8px; margin-bottom:8px; color:rgba(255,255,255,.7) }
  .sb-foot .user .avatar { width:28px; height:28px; border-radius:50%; background:rgba(255,255,255,.12); display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; color:#fff }
  .logout-btn { display:block; width:100%; padding:8px; background:rgba(255,255,255,.06); border:none; border-radius:6px; color:rgba(255,255,255,.55); font-size:12px; cursor:pointer; font-family:inherit; text-align:center; transition:background .12s }
  .logout-btn:hover { background:rgba(255,255,255,.1); color:#fff }

  /* ── main ── */
  .main { margin-left:240px; flex:1; min-height:100vh; display:flex; flex-direction:column }
  .topbar { background:var(--topbar-bg); border-bottom:1px solid var(--line); padding:14px 28px; display:flex; align-items:center; gap:16px; position:sticky; top:0; z-index:50; transition: background .3s, border-color .3s; }
  .topbar h1 { font-size:16px; font-weight:700; color:var(--ink); letter-spacing:-.2px }
  .topbar .spacer { flex:1 }
  .topbar .top-user { font-size:13px; color:var(--muted); display:flex; align-items:center; gap:8px }
  .content { flex:1; padding:28px; max-width:1200px; width:100%; animation: pageIn .28s ease both; }
  @keyframes pageIn { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }

  /* ── page header ── */
  .page-header { margin-bottom:24px }
  .page-header h2 { font-size:22px; font-weight:700; color:var(--ink); letter-spacing:-.3px }
  .page-header .page-sub { font-size:14px; color:var(--muted); margin-top:4px }
  .back-link { display:inline-block; font-size:13px; color:var(--muted); margin-bottom:8px; font-weight:500 }
  .back-link:hover { color:var(--ink) }

  /* ── stat cards ── */
  .stat-cards { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; margin-bottom:28px }
  .stat-card {
    background:var(--card-bg); border:1px solid var(--line); border-radius:12px;
    padding:18px 20px; box-shadow:0 1px 3px rgba(0,0,0,.03);
    transition: transform .2s ease, box-shadow .2s ease, background .3s, border-color .3s;
  }
  .stat-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,.06); }
  .stat-num { font-size:28px; font-weight:800; color:var(--ink); line-height:1.1 }
  .stat-label { font-size:12.5px; color:var(--muted); margin-top:4px; font-weight:500 }

  /* ── campaign cards ── */
  .section-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:14px }
  .section-head h3 { font-size:15px; font-weight:700; color:var(--ink) }
  .section-head .link { font-size:13px; color:var(--muted); font-weight:500 }
  .section-head .link:hover { color:var(--ink) }
  .camp-cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:14px }
  .camp-card {
    display:block; background:var(--card-bg); border:1px solid var(--line);
    border-radius:12px; padding:16px 18px;
    transition: box-shadow .2s, border-color .2s, transform .2s, background .3s;
    cursor:pointer;
  }
  .camp-card:hover { border-color:var(--muted); box-shadow:0 4px 12px rgba(0,0,0,.06); transform:translateY(-2px) }
  .camp-card-head { margin-bottom:10px }
  .camp-name { font-size:14px; font-weight:700; color:var(--ink); display:block }
  .camp-file { font-size:11px; color:var(--muted); font-family:monospace; margin-top:2px; display:block }
  .camp-card-stats { display:flex; gap:16px; align-items:center; margin-bottom:8px; flex-wrap:wrap }
  .cc-stat { font-size:12px; color:var(--muted) }
  .cc-num { font-size:16px; font-weight:700 }
  .cc-num.ok { color:var(--green) }
  .cc-num.fail { color:var(--red) }
  .cc-bar { flex:1; height:5px; background:var(--line); border-radius:999px; overflow:hidden; min-width:60px }
  .cc-fill { height:100%; border-radius:999px; transition:width .3s }
  .camp-card-foot { font-size:11px; color:var(--muted) }

  /* ── empty state ── */
  .empty-state { text-align:center; padding:40px 20px; color:var(--muted) }
  .empty-state svg { margin-bottom:12px }
  .empty-state h3 { font-size:16px; font-weight:600; color:var(--ink); margin-bottom:4px }
  .empty-state p { font-size:13px }

  /* ── table ── */
  .table-wrap { overflow-x:auto; background:var(--card-bg); border:1px solid var(--line); border-radius:12px; transition: background .3s, border-color .3s; }
  .data-table { width:100%; border-collapse:collapse; font-size:13px }
  .data-table th {
    text-align:left; padding:11px 14px;
    background:var(--table-hover); color:var(--ink);
    font-size:12px; font-weight:600; white-space:nowrap;
    border-bottom:1px solid var(--line);
  }
  .data-table td { padding:11px 14px; border-bottom:1px solid var(--line); vertical-align:middle }
  .data-table tr:hover td { background: var(--table-hover); }
  .data-table tr:last-child td { border-bottom:none }
  .data-table code { background:var(--table-hover); border-radius:4px; padding:2px 6px; font-size:11.5px; color:var(--ink) }
  .bar-sm { display:inline-flex; width:80px; height:5px; background:var(--line); border-radius:999px; overflow:hidden; vertical-align:middle }
  .bar-fill-sm { height:100%; border-radius:999px }
  .btn-sm { display:inline-block; padding:5px 12px; background:var(--table-hover); border-radius:6px; font-size:12px; font-weight:600; color:var(--ink); transition:background .12s }
  .btn-sm:hover { background:var(--line); color:var(--ink) }

  .badge { display:inline-block; padding:3px 10px; border-radius:999px; font-size:11px; font-weight:600 }
  .badge-ok { background:#ecfdf5; color:var(--green) }
  .badge-fail { background:#fef2f2; color:var(--red) }

  /* ── form ── */
  .form-card { background:var(--card-bg); border:1px solid var(--line); border-radius:12px; padding:28px; max-width:640px; transition: background .3s, border-color .3s; }
  .field { margin-bottom:18px }
  .field label { display:block; font-size:13px; font-weight:600; color:var(--ink); margin-bottom:6px }
  .field .hint { font-weight:400; color:var(--muted); font-size:12px }
  .field input[type="text"],.field input[type="number"],.field textarea {
    width:100%; padding:10px 13px;
    border:1.5px solid var(--input-border); border-radius:8px;
    font-size:14px; font-family:inherit;
    color:var(--ink); background:var(--input-bg);
    outline:none; transition: border-color .12s, background .3s, color .3s;
  }
  .field input:focus,.field textarea:focus { border-color:var(--navy); box-shadow:0 0 0 3px rgba(17,24,68,.08) }
  .field textarea { resize:vertical; min-height:90px }
  .field-row { display:grid; grid-template-columns:1fr 1fr; gap:14px }
  .field input[type="file"] { font-size:13px; color:var(--muted) }
  .note-box { display:flex; gap:10px; align-items:flex-start; background:var(--amber-soft, #fffbeb); border:1px solid #fde68a; border-radius:8px; padding:12px 14px; font-size:12.5px; color:#92400e; margin-bottom:18px; line-height:1.5 }
  .note-box svg { flex-shrink:0; margin-top:1px }

  .btn { display:inline-flex; align-items:center; gap:8px; padding:10px 22px; border:none; border-radius:8px; font-size:14px; font-weight:600; font-family:inherit; cursor:pointer; transition:all .12s; position:relative; overflow:hidden }
  .btn-primary { background:var(--navy); color:#fff }
  .btn-primary:hover { background:var(--navy-hover); box-shadow:0 4px 12px rgba(18,19,88,.2) }
  .btn-primary:active { transform:scale(.97) }

  /* ── responsive ── */
  @media (max-width:820px) {
    .sidebar { width:200px }
    .main { margin-left:200px }
    .stat-cards { grid-template-columns:repeat(2,1fr) }
    .topbar { padding:12px 18px }
    .content { padding:18px }
  }
  @media (max-width:640px) {
    body { flex-direction:column }
    .sidebar { position:static; width:100%; flex-direction:row; padding:8px 12px; align-items:center; gap:8px; min-height:56px }
    .sb-brand { border:none; padding:0; flex-shrink:0 }
    .sb-nav { flex-direction:row; padding:0; overflow-x:auto; gap:0 }
    .sb-foot { display:none }
    .nav-item { padding:8px 10px; white-space:nowrap; flex-shrink:0 }
    .nav-item span { display:none }
    .nav-item.active span { display:inline }
    .main { margin-left:0 }
    .stat-cards { grid-template-columns:1fr 1fr }
    .camp-cards { grid-template-columns:1fr }
    .field-row { grid-template-columns:1fr }
    .topbar h1 { font-size:14px }
  }
</style>
</head>
<body>

<aside class="sidebar">
  <div class="sb-brand">
    <div class="logo">
      <svg viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
    </div>
    <div class="t"><strong>WhatsApp SaaS</strong><small>Campaign Manager</small></div>
  </div>
  <div class="sb-nav">${navHtml}</div>
  <div class="sb-foot">
    <div class="user"><div class="avatar">${escHtml(username).charAt(0).toUpperCase()}</div>${escHtml(username)}</div>
    <button class="logout-btn" onclick="navigator.sendBeacon('/auth/logout','{}');window.location.href='/auth/login'">Sign Out</button>
  </div>
</aside>

<div class="main">
  <div class="topbar">
    <h1>WhatsApp Campaign SaaS</h1>
    <div class="spacer"></div>
    <button id="darkToggle" title="Toggle dark mode"><i class="fa-solid fa-moon" id="darkIcon"></i></button>
    <div class="top-user">
      <span>${escHtml(username)}</span>
      <span style="color:var(--line)">|</span>
      <a href="/auth/login" style="font-size:12px;color:var(--muted)" onclick="event.preventDefault();navigator.sendBeacon('/auth/logout','{}');window.location.href='/auth/login'">Sign Out</a>
    </div>
  </div>
  <div class="content">${content}</div>
</div>

<script>
  // dark mode
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const storedDark = localStorage.getItem('wapi_dark');
  if (storedDark === '1' || (storedDark === null && prefersDark)) {
    document.body.classList.add('dark');
    const icon = document.getElementById('darkIcon');
    if (icon) icon.className = 'fa-solid fa-sun';
  }
  const dt = document.getElementById('darkToggle');
  if (dt) {
    dt.onclick = () => {
      document.body.classList.toggle('dark');
      const isDark = document.body.classList.contains('dark');
      const icon = document.getElementById('darkIcon');
      if (icon) icon.className = isDark ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
      localStorage.setItem('wapi_dark', isDark ? '1' : '0');
    };
  }
</script>
</body>
</html>`;
}

/* ── utility ── */
function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ── 404 catch-all ── */
app.use((req, res) => {
  if (req.accepts("html")) {
    res.status(404).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Not Found</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f5f6fa;color:#6b7280}div{text-align:center}h2{color:#111844;margin-bottom:8px}a{color:#111844}</style></head><body><div><h2>404</h2><p>Page not found</p><p style="margin-top:12px"><a href="/">← Go home</a></p></div></body></html>`);
  } else {
    res.status(404).json({ success: false, error: "Not found" });
  }
});

/* ── start ── */
app.listen(PORT, () => {
  console.log(`[WhatsApp Campaign SaaS] Dashboard running on http://127.0.0.1:${PORT}`);
  console.log(`[Auth] Default login: ${ADMIN_USER} / ${ADMIN_PASS}`);
});
