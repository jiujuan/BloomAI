import { Hono } from 'hono'
import { getSkillSecurityStatus } from '../../skills/security/skill-security-checklist'

export const skillSecurityRoutes = new Hono()

skillSecurityRoutes.get('/skill-security/status', (c) => {
  if (c.req.header('x-bloom-role')?.trim().toLowerCase() !== 'admin') {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Administrator access required' } }, 403)
  }
  return c.json({ data: getSkillSecurityStatus() })
})
