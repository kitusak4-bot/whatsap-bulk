import { randomUUID } from 'node:crypto'

export class ContactService {
  constructor(db) {
    this.db = db

    this.stmtInsertContact = db.prepare(`
      INSERT INTO contacts (id, team_id, name, number, tags, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.stmtUpdateContact = db.prepare(`
      UPDATE contacts SET name=?, number=?, tags=?, metadata_json=?, updated_at=? WHERE id=? AND team_id=?
    `)
    this.stmtDeleteContact = db.prepare('DELETE FROM contacts WHERE id=? AND team_id=?')
    this.stmtFindContact = db.prepare('SELECT * FROM contacts WHERE id=? AND team_id=?')
    this.stmtListContacts = db.prepare('SELECT * FROM contacts WHERE team_id=? ORDER BY created_at DESC')
    this.stmtFindByNumber = db.prepare('SELECT * FROM contacts WHERE team_id=? AND number=?')
    this.stmtSearchContacts = db.prepare('SELECT * FROM contacts WHERE team_id=? AND (name LIKE ? OR number LIKE ?) ORDER BY created_at DESC LIMIT ?')

    this.stmtInsertGroup = db.prepare(`
      INSERT INTO contact_groups (id, team_id, name, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    this.stmtUpdateGroup = db.prepare(`
      UPDATE contact_groups SET name=?, description=?, updated_at=? WHERE id=? AND team_id=?
    `)
    this.stmtDeleteGroup = db.prepare('DELETE FROM contact_groups WHERE id=? AND team_id=?')
    this.stmtFindGroup = db.prepare('SELECT * FROM contact_groups WHERE id=? AND team_id=?')
    this.stmtListGroups = db.prepare('SELECT * FROM contact_groups WHERE team_id=? ORDER BY name ASC')

    this.stmtAddToGroup = db.prepare('INSERT OR IGNORE INTO contact_group_members (group_id, contact_id) VALUES (?, ?)')
    this.stmtRemoveFromGroup = db.prepare('DELETE FROM contact_group_members WHERE group_id=? AND contact_id=?')
    this.stmtGroupMembers = db.prepare(`
      SELECT c.* FROM contacts c JOIN contact_group_members m ON c.id = m.contact_id
      WHERE m.group_id=? ORDER BY c.name ASC
    `)
    this.stmtContactGroups = db.prepare(`
      SELECT g.* FROM contact_groups g JOIN contact_group_members m ON g.id = m.group_id
      WHERE m.contact_id=? ORDER BY g.name ASC
    `)
    this.stmtGroupCount = db.prepare(`
      SELECT g.id, g.name, COUNT(m.contact_id) AS member_count
      FROM contact_groups g LEFT JOIN contact_group_members m ON g.id = m.group_id
      WHERE g.team_id=? GROUP BY g.id ORDER BY g.name ASC
    `)
  }

  // Contacts
  listContacts(teamId) {
    return this.stmtListContacts.all(teamId).map(this._formatContact)
  }

  getContact(teamId, id) {
    const row = this.stmtFindContact.get(id, teamId)
    return row ? this._formatContact(row) : null
  }

  findByNumber(teamId, number) {
    const row = this.stmtFindByNumber.get(teamId, number)
    return row ? this._formatContact(row) : null
  }

  search(teamId, query, limit = 50) {
    const pattern = `%${query}%`
    return this.stmtSearchContacts.all(teamId, pattern, pattern, limit).map(this._formatContact)
  }

  createContact(teamId, { name, number, tags, metadata }) {
    const id = randomUUID()
    const now = new Date().toISOString()
    const tagsJson = JSON.stringify(tags || [])
    const metaJson = JSON.stringify(metadata || {})
    this.stmtInsertContact.run(id, teamId, name, number, tagsJson, metaJson, now, now)
    return this.getContact(teamId, id)
  }

  updateContact(teamId, id, { name, number, tags, metadata }) {
    const existing = this.stmtFindContact.get(id, teamId)
    if (!existing) return null
    const now = new Date().toISOString()
    this.stmtUpdateContact.run(
      name ?? existing.name,
      number ?? existing.number,
      tags ? JSON.stringify(tags) : existing.tags,
      metadata ? JSON.stringify(metadata) : existing.metadata_json,
      now, id, teamId
    )
    return this.getContact(teamId, id)
  }

  deleteContact(teamId, id) {
    const existing = this.stmtFindContact.get(id, teamId)
    if (!existing) return false
    this.stmtDeleteContact.run(id, teamId)
    return true
  }

  upsertByNumber(teamId, { name, number, tags, metadata }) {
    const existing = this.findByNumber(teamId, number)
    if (existing) {
      return this.updateContact(teamId, existing.id, { name, number, tags, metadata })
    }
    return this.createContact(teamId, { name, number, tags, metadata })
  }

  // Groups
  listGroups(teamId) {
    return this.stmtGroupCount.all(teamId)
  }

  getGroup(teamId, id) {
    const row = this.stmtFindGroup.get(id, teamId)
    if (!row) return null
    return { ...row, memberCount: this.db.prepare('SELECT COUNT(*) AS n FROM contact_group_members WHERE group_id=?').get(id).n }
  }

  createGroup(teamId, { name, description }) {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.stmtInsertGroup.run(id, teamId, name, description || '', now, now)
    return this.getGroup(teamId, id)
  }

  updateGroup(teamId, id, { name, description }) {
    const existing = this.stmtFindGroup.get(id, teamId)
    if (!existing) return null
    const now = new Date().toISOString()
    this.stmtUpdateGroup.run(name ?? existing.name, description ?? existing.description, now, id, teamId)
    return this.getGroup(teamId, id)
  }

  deleteGroup(teamId, id) {
    const existing = this.stmtFindGroup.get(id, teamId)
    if (!existing) return false
    this.stmtDeleteGroup.run(id, teamId)
    return true
  }

  getGroupMembers(teamId, groupId) {
    const group = this.stmtFindGroup.get(groupId, teamId)
    if (!group) return null
    return this.stmtGroupMembers.all(groupId).map(this._formatContact)
  }

  addToGroup(teamId, groupId, contactIds) {
    const group = this.stmtFindGroup.get(groupId, teamId)
    if (!group) return null
    const ids = Array.isArray(contactIds) ? contactIds : [contactIds]
    for (const contactId of ids) {
      this.stmtAddToGroup.run(groupId, contactId)
    }
    return { added: ids.length }
  }

  removeFromGroup(teamId, groupId, contactId) {
    const group = this.stmtFindGroup.get(groupId, teamId)
    if (!group) return false
    this.stmtRemoveFromGroup.run(groupId, contactId)
    return true
  }

  getContactGroups(teamId, contactId) {
    const contact = this.stmtFindContact.get(contactId, teamId)
    if (!contact) return null
    return this.stmtContactGroups.all(contactId)
  }

  _formatContact(row) {
    return {
      id: row.id,
      teamId: row.team_id,
      name: row.name,
      number: row.number,
      tags: JSON.parse(row.tags || '[]'),
      metadata: JSON.parse(row.metadata_json || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}
