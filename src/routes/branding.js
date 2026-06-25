import { Router } from 'express'
import { requireTeamMember } from '../middleware/tenant.js'
import { asyncHandler } from '../utils/errors.js'
import { ok } from '../utils/response.js'

export const createBrandingRouter = ({ branding }) => {
  const router = Router()
  router.use(requireTeamMember)

  router.get('/', asyncHandler(async (req, res) => {
    const data = branding.get(req.apiKey.teamId)
    ok(res, data || { brandName: null, logoUrl: null, primaryColor: null, secondaryColor: null, faviconUrl: null, customDomain: null, supportEmail: null })
  }))

  router.put('/', asyncHandler(async (req, res) => {
    const data = branding.upsert(req.apiKey.teamId, req.body)
    ok(res, data)
  }))

  return router
}
