export class WhiteLabelService {
  constructor(db) {
    this.db = db
    this.stmtUpsert = db.prepare(`
      INSERT INTO team_branding (team_id, brand_name, logo_url, primary_color, secondary_color, favicon_url, custom_domain, support_email, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(team_id) DO UPDATE SET
        brand_name=excluded.brand_name, logo_url=excluded.logo_url, primary_color=excluded.primary_color,
        secondary_color=excluded.secondary_color, favicon_url=excluded.favicon_url,
        custom_domain=excluded.custom_domain, support_email=excluded.support_email, updated_at=excluded.updated_at
    `)
    this.stmtGet = db.prepare('SELECT * FROM team_branding WHERE team_id=?')
  }

  get(teamId) {
    const row = this.stmtGet.get(teamId)
    if (!row) return null
    return {
      brandName: row.brand_name,
      logoUrl: row.logo_url,
      primaryColor: row.primary_color,
      secondaryColor: row.secondary_color,
      faviconUrl: row.favicon_url,
      customDomain: row.custom_domain,
      supportEmail: row.support_email
    }
  }

  upsert(teamId, data) {
    const now = new Date().toISOString()
    this.stmtUpsert.run(
      teamId,
      data.brandName || null,
      data.logoUrl || null,
      data.primaryColor || null,
      data.secondaryColor || null,
      data.faviconUrl || null,
      data.customDomain || null,
      data.supportEmail || null,
      now
    )
    return this.get(teamId)
  }
}
