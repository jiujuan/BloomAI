import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  findDependencyBoundaryViolations,
  findProductionDependencyBoundaryViolations,
} from './dependency-boundaries'

const serverDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

function violation(layer: 'route' | 'repository' | 'service', file: string, source: string, reason: string) {
  return { layer, file, source, reason }
}

describe('server dependency boundaries', () => {
  it('reports Route imports that bypass application services', () => {
    expect(findDependencyBoundaryViolations({
      layer: 'route',
      sources: {
        'new-route.ts': [
          "import { personaRepo } from '../../db/repositories/persona.repo'",
          "import { registry } from '../../llm/registry'",
          "import { mastra } from '../../mastra'",
          "import { runtime } from '../../skills/runtime'",
        ].join('\n'),
      },
    })).toEqual([
      violation('route', 'new-route.ts', '../../db/repositories/persona.repo', 'HTTP routes must call application services instead of repositories or runtimes'),
      violation('route', 'new-route.ts', '../../llm/registry', 'HTTP routes must call application services instead of repositories or runtimes'),
      violation('route', 'new-route.ts', '../../mastra', 'HTTP routes must call application services instead of repositories or runtimes'),
      violation('route', 'new-route.ts', '../../skills/runtime', 'HTTP routes must call application services instead of repositories or runtimes'),
    ])
  })

  it('reports Repository imports of services, HTTP, and runtime layers', () => {
    expect(findDependencyBoundaryViolations({
      layer: 'repository',
      sources: {
        'legacy.repo.ts': [
          "import { personaService } from '../../services/persona.service'",
          "import { app } from '../../http/app'",
          "import { resolveModel } from '../../llm/registry'",
          "import { coordinator } from '../../skills/runtime/skill-run-coordinator'",
        ].join('\n'),
      },
    })).toEqual([
      violation('repository', 'legacy.repo.ts', '../../services/persona.service', 'Repositories must only depend on persistence code, not services, HTTP, or runtimes'),
      violation('repository', 'legacy.repo.ts', '../../http/app', 'Repositories must only depend on persistence code, not services, HTTP, or runtimes'),
      violation('repository', 'legacy.repo.ts', '../../llm/registry', 'Repositories must only depend on persistence code, not services, HTTP, or runtimes'),
      violation('repository', 'legacy.repo.ts', '../../skills/runtime/skill-run-coordinator', 'Repositories must only depend on persistence code, not services, HTTP, or runtimes'),
    ])
  })

  it('reports service imports of Routes and Hono', () => {
    expect(findDependencyBoundaryViolations({
      layer: 'service',
      sources: {
        'legacy.service.ts': [
          "import { chatRoutes } from '../http/routes/chat'",
          "import type { Context } from 'hono'",
        ].join('\n'),
      },
    })).toEqual([
      violation('service', 'legacy.service.ts', '../http/routes/chat', 'Application services must not depend on HTTP routes or Hono'),
      violation('service', 'legacy.service.ts', 'hono', 'Application services must not depend on HTTP routes or Hono'),
    ])
  })

  it('recognizes forbidden imports from nested directories', () => {
    expect(findDependencyBoundaryViolations({
      layer: 'route',
      sources: { 'nested/child-route.ts': "import { personaRepo } from '../../../db/repositories/persona.repo'" },
    })).toEqual([
      violation('route', 'nested/child-route.ts', '../../../db/repositories/persona.repo', 'HTTP routes must call application services instead of repositories or runtimes'),
    ])
    expect(findDependencyBoundaryViolations({
      layer: 'repository',
      sources: { 'nested/legacy.repo.ts': "import { coordinator } from '../../../skills/runtime/skill-run-coordinator'" },
    })).toEqual([
      violation('repository', 'nested/legacy.repo.ts', '../../../skills/runtime/skill-run-coordinator', 'Repositories must only depend on persistence code, not services, HTTP, or runtimes'),
    ])
    expect(findDependencyBoundaryViolations({
      layer: 'service',
      sources: { 'nested/legacy.service.ts': "import { chatRoutes } from '../../http/routes/chat'" },
    })).toEqual([
      violation('service', 'nested/legacy.service.ts', '../../http/routes/chat', 'Application services must not depend on HTTP routes or Hono'),
    ])
  })

  it('requires documented metadata for every temporary exception', () => {
    expect(() => findDependencyBoundaryViolations({
      layer: 'repository',
      sources: {
        'legacy.repo.ts': "import { coordinator } from '../../skills/runtime/skill-run-coordinator'",
      },
      allowlist: [{
        layer: 'repository',
        file: 'legacy.repo.ts',
        source: '../../skills/runtime/skill-run-coordinator',
        reason: ' ',
        owner: 'Backend team',
        removeByPhase: 'Phase 7',
      }],
    })).toThrow('reason')
  })

  it('honors an explicitly documented temporary exception', () => {
    expect(findDependencyBoundaryViolations({
      layer: 'repository',
      sources: {
        'legacy.repo.ts': "import { coordinator } from '../../skills/runtime/skill-run-coordinator'",
      },
      allowlist: [{
        layer: 'repository',
        file: 'legacy.repo.ts',
        source: '../../skills/runtime/skill-run-coordinator',
        reason: 'Temporary compatibility adapter while the runtime is extracted.',
        owner: 'Backend architecture',
        removeByPhase: 'Phase 7',
      }],
    })).toEqual([])
  })

  it('keeps every production Route, Service, and Repository within the strict boundary', () => {
    expect(findProductionDependencyBoundaryViolations({ serverDirectory })).toEqual([])
  })
})
