import { Hono, type Context } from 'hono'
import { projectService } from '../../services/project.service'
import { ServiceError } from '../../services/errors'
import { readJson } from '../util'

export const projectsRoutes = new Hono()

function readPage(c: Context) {
  const read = (key: string, fallback: number) => {
    const value = c.req.query(key)
    if (value === undefined) return fallback
    if (!/^(0|[1-9]\d*)$/.test(value)) throw new ServiceError('VALIDATION_ERROR', `${key} must be a non-negative integer`)
    return Number(value)
  }
  return { limit: read('limit', 10), offset: read('offset', 0) }
}

projectsRoutes.get('/', (c) => c.json({ data: projectService.listProjects() }))
projectsRoutes.post('/', async (c) => c.json({ data: projectService.createProject(await readJson(c)) }, 201))
projectsRoutes.get('/:id/sessions', (c) => c.json(projectService.listProjectSessions(c.req.param('id'), readPage(c))))
projectsRoutes.post('/:id/sessions', async (c) => c.json({ data: projectService.createProjectSession(c.req.param('id'), await readJson(c)) }, 201))
