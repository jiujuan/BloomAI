import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { findRouteDependencyBoundaryViolations } from '../architecture/dependency-boundaries'

const routesDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'routes')

describe('HTTP route dependency boundary', () => {
  it('reports a newly introduced direct repository import that is not explicitly grandfathered', () => {
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

  it('accepts only the explicitly documented legacy imports while the migration is in progress', () => {
    expect(findRouteDependencyBoundaryViolations()).toEqual([])
  })

  it('keeps every production route within the current migration allowlist', () => {
    expect(findRouteDependencyBoundaryViolations({ routesDirectory })).toEqual([])
  })
})
