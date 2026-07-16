import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { findRouteDependencyBoundaryViolations } from '../architecture/dependency-boundaries'

const routesDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'routes')

describe('HTTP route dependency boundary', () => {
  it('reports a newly introduced direct repository import', () => {
    expect(findRouteDependencyBoundaryViolations({
      'new-route.ts': "import { personaRepo } from '../../db/repositories/persona.repo'",
    })).toEqual([
      {
        file: 'new-route.ts',
        source: '../../db/repositories/persona.repo',
        reason: 'HTTP routes must call application services instead of repositories or runtimes',
      },
    ])
  })

  it('does not grandfather Article Illustration or Attachment runtime imports', () => {
    expect(findRouteDependencyBoundaryViolations({
      'article-illustrations.ts': "import { articleIllustrationService } from '../../skills/article-illustrations/article-illustration.service'",
      'attachments.ts': "import { saveAttachment } from '../../attachments/attachment-service'",
    })).toEqual([
      {
        file: 'article-illustrations.ts',
        source: '../../skills/article-illustrations/article-illustration.service',
        reason: 'HTTP routes must call application services instead of repositories or runtimes',
      },
      {
        file: 'attachments.ts',
        source: '../../attachments/attachment-service',
        reason: 'HTTP routes must call application services instead of repositories or runtimes',
      },
    ])
  })

  it('keeps every production route within the strict service boundary', () => {
    expect(findRouteDependencyBoundaryViolations({ routesDirectory })).toEqual([])
  })
})
