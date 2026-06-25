import { Router } from 'express'
import { z } from 'zod'
import { requireTeamMember } from '../middleware/tenant.js'
import { validate } from '../middleware/validate.js'
import { asyncHandler, AppError } from '../utils/errors.js'
import { ok } from '../utils/response.js'

const contactSchema = z.object({
  name: z.string().trim().min(1).max(200),
  number: z.string().trim().min(8).max(80),
  tags: z.array(z.string()).optional().default([]),
  metadata: z.record(z.unknown()).optional().default({})
})

const groupSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional().default('')
})

export const createContactRouter = ({ contacts, audit }) => {
  const router = Router()
  router.use(requireTeamMember)

  // ---- Contacts ----
  router.get('/', asyncHandler(async (req, res) => {
    const { query } = req.query
    if (query) {
      return ok(res, contacts.search(req.apiKey.teamId, query))
    }
    ok(res, contacts.listContacts(req.apiKey.teamId))
  }))

  router.get('/:id', asyncHandler(async (req, res) => {
    const c = contacts.getContact(req.apiKey.teamId, req.params.id)
    if (!c) throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contact not found')
    ok(res, c)
  }))

  router.post('/', validate(contactSchema), asyncHandler(async (req, res) => {
    const c = contacts.createContact(req.apiKey.teamId, req.body)
    audit.write({
      teamId: req.apiKey.teamId, userId: req.apiKey.userId, apiKeyId: req.apiKey.id,
      action: 'contact.created', resource: 'contact', resourceId: c.id
    })
    ok(res, c, 201)
  }))

  router.put('/:id', asyncHandler(async (req, res) => {
    const c = contacts.updateContact(req.apiKey.teamId, req.params.id, req.body)
    if (!c) throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contact not found')
    audit.write({
      teamId: req.apiKey.teamId, userId: req.apiKey.userId, apiKeyId: req.apiKey.id,
      action: 'contact.updated', resource: 'contact', resourceId: c.id
    })
    ok(res, c)
  }))

  router.delete('/:id', asyncHandler(async (req, res) => {
    const removed = contacts.deleteContact(req.apiKey.teamId, req.params.id)
    if (!removed) throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contact not found')
    audit.write({
      teamId: req.apiKey.teamId, userId: req.apiKey.userId, apiKeyId: req.apiKey.id,
      action: 'contact.deleted', resource: 'contact', resourceId: req.params.id
    })
    ok(res, { deleted: true })
  }))

  // ---- Groups ----
  router.get('/groups/list', asyncHandler(async (req, res) => {
    ok(res, contacts.listGroups(req.apiKey.teamId))
  }))

  router.post('/groups', validate(groupSchema), asyncHandler(async (req, res) => {
    const g = contacts.createGroup(req.apiKey.teamId, req.body)
    audit.write({
      teamId: req.apiKey.teamId, userId: req.apiKey.userId, apiKeyId: req.apiKey.id,
      action: 'group.created', resource: 'group', resourceId: g.id
    })
    ok(res, g, 201)
  }))

  router.get('/groups/:id', asyncHandler(async (req, res) => {
    const g = contacts.getGroup(req.apiKey.teamId, req.params.id)
    if (!g) throw new AppError(404, 'GROUP_NOT_FOUND', 'Group not found')
    ok(res, g)
  }))

  router.put('/groups/:id', asyncHandler(async (req, res) => {
    const g = contacts.updateGroup(req.apiKey.teamId, req.params.id, req.body)
    if (!g) throw new AppError(404, 'GROUP_NOT_FOUND', 'Group not found')
    audit.write({
      teamId: req.apiKey.teamId, userId: req.apiKey.userId, apiKeyId: req.apiKey.id,
      action: 'group.updated', resource: 'group', resourceId: g.id
    })
    ok(res, g)
  }))

  router.delete('/groups/:id', asyncHandler(async (req, res) => {
    const removed = contacts.deleteGroup(req.apiKey.teamId, req.params.id)
    if (!removed) throw new AppError(404, 'GROUP_NOT_FOUND', 'Group not found')
    audit.write({
      teamId: req.apiKey.teamId, userId: req.apiKey.userId, apiKeyId: req.apiKey.id,
      action: 'group.deleted', resource: 'group', resourceId: req.params.id
    })
    ok(res, { deleted: true })
  }))

  router.get('/groups/:id/members', asyncHandler(async (req, res) => {
    const members = contacts.getGroupMembers(req.apiKey.teamId, req.params.id)
    if (members === null) throw new AppError(404, 'GROUP_NOT_FOUND', 'Group not found')
    ok(res, members)
  }))

  router.post('/groups/:id/members', asyncHandler(async (req, res) => {
    const { contactIds } = req.body
    if (!contactIds?.length) throw new AppError(400, 'VALIDATION_ERROR', 'contactIds array is required')
    const result = contacts.addToGroup(req.apiKey.teamId, req.params.id, contactIds)
    if (result === null) throw new AppError(404, 'GROUP_NOT_FOUND', 'Group not found')
    audit.write({
      teamId: req.apiKey.teamId, userId: req.apiKey.userId, apiKeyId: req.apiKey.id,
      action: 'group.members_added', resource: 'group', resourceId: req.params.id
    })
    ok(res, result)
  }))

  router.delete('/groups/:groupId/members/:contactId', asyncHandler(async (req, res) => {
    const removed = contacts.removeFromGroup(req.apiKey.teamId, req.params.groupId, req.params.contactId)
    if (!removed) throw new AppError(404, 'GROUP_NOT_FOUND', 'Group not found')
    ok(res, { deleted: true })
  }))

  return router
}
