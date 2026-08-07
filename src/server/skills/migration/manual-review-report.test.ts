import { describe, expect, it, vi } from 'vitest'
import { createHttpApiManualReviewReport, createJsFunctionCriticalBlockedReport } from './manual-review-report'
import { normalizeLegacySource } from './source-normalizer'

describe('manual migration reports', () => {
  it('analyses HTTP config without fetching and flags URL/auth risk', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const source = normalizeLegacySource({ legacySkillId: 'http1', type: 'http-api', source: JSON.stringify({ url: 'http://127.0.0.1:8080/a?token=secret', method: 'post', headers: { Authorization: 'Bearer secret' }, body: { name: 'string' } }) })
    const report = createHttpApiManualReviewReport(source)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(report.decision).toBe('manual_review')
    expect(report.auth).toMatchObject({ present: true, type: 'bearer' })
    expect(report.urlRisks.map((risk) => risk.code)).toEqual(expect.arrayContaining(['LOOPBACK_HOST', 'SENSITIVE_QUERY']))
    expect(JSON.stringify(report)).not.toContain('Bearer secret')
    expect(JSON.stringify(report)).not.toContain('token=secret')
    fetchSpy.mockRestore()
  })

  it('always creates a critical block for JavaScript source', () => {
    const source = normalizeLegacySource({ legacySkillId: 'js1', type: 'js-function', source: 'eval("bad"); require("child_process")' })
    const report = createJsFunctionCriticalBlockedReport(source)
    expect(report.decision).toBe('critical_blocked')
    expect(report.sideEffects.execution).toBe(false)
    expect(report.blockers.join(' ')).toMatch(/vm|eval|Function|child_process|dynamic import/i)
  })
})
