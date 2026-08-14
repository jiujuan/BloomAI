import { describe, expect, it } from 'vitest'
import {
  getSkillOperationForRequest,
  getSkillRole,
  isSkillOperationAllowed,
  type SkillOperation,
} from './skills-policy'

describe('Skills Admin P0 authorization boundary', () => {
  it('fails closed to the user role when the role is absent or unknown', () => {
    expect(getSkillRole(undefined)).toBe('user')
    expect(getSkillRole('superuser')).toBe('user')
    expect(isSkillOperationAllowed('user', 'package.install')).toBe(true)
    expect(isSkillOperationAllowed('user', 'package.update')).toBe(true)
    expect(isSkillOperationAllowed('user', 'package.delete')).toBe(true)
    expect(isSkillOperationAllowed('user', 'package.read')).toBe(true)
    expect(isSkillOperationAllowed('user', 'package.inspect')).toBe(true)
    expect(isSkillOperationAllowed('user', 'import.review')).toBe(true)
    expect(isSkillOperationAllowed('user', 'run.create')).toBe(true)
  })

  it('keeps runtime, installation, grant, run and export management restricted', () => {
    const restricted: SkillOperation[] = [
      'installation.manage',
      'grant.manage',
      'run.manage',
      'artifact.export',
    ]
    for (const operation of restricted) {
      expect(isSkillOperationAllowed('user', operation)).toBe(false)
      expect(isSkillOperationAllowed('admin', operation)).toBe(true)
      expect(isSkillOperationAllowed('owner', operation)).toBe(true)
    }
  })

  it('maps destructive Skills requests to a stable operation name', () => {
    expect(getSkillOperationForRequest('POST', '/api/v1/skill-packages/install')).toBe('package.install')
    expect(getSkillOperationForRequest('POST', '/api/v1/skill-import-reviews/review-1/approve')).toBe('import.review')
    expect(getSkillOperationForRequest('POST', '/api/v1/skill-packages/pkg-1/update/preview')).toBe('package.update')
    expect(getSkillOperationForRequest('POST', '/api/v1/skill-packages/pkg-1/update')).toBe('package.update')
    expect(getSkillOperationForRequest('DELETE', '/api/v1/skill-packages/pkg-1')).toBe('package.delete')
    expect(getSkillOperationForRequest('PATCH', '/api/v1/skill-installations/i-1')).toBe('installation.manage')
    expect(getSkillOperationForRequest('POST', '/api/v1/skill-runs/r-1/cancel')).toBe('run.manage')
    expect(getSkillOperationForRequest('GET', '/api/v1/skill-packages')).toBeUndefined()
  })
})
