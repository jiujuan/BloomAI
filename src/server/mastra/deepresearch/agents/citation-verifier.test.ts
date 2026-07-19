import { describe, expect, it } from 'vitest'
import { createDeterministicCitationVerifier } from './citation-verifier'

const claim = (text: string) => ({ id: 'claim-1', runId: 'run-1', sectionId: 'section-1', text, kind: 'factual' as const, importance: 'high' as const, verificationStatus: 'not_applicable' as const, confidence: 0.8, repairHistory: [] })
const evidence = (passage: string) => ({ id: 'evidence-1', runId: 'run-1', questionId: 'question-1', snapshotId: 'snapshot-1', passage, summary: passage, stance: 'supporting' as const, confidence: 0.8, startOffset: 0, endOffset: passage.length })

describe('deterministic citation verifier', () => {
  it('never auto-approves a citation without semantic model verification', async () => {
    const result = await createDeterministicCitationVerifier().verify({ claim: claim('Acme reported 20% growth in 2025.'), evidence: evidence('Acme reported 20% growth in 2025.') })
    expect(result).toMatchObject({ status: 'partially_supported', verificationMethod: 'conservative_structural' })
  })

  it('rejects numeric and stance mismatches conservatively', async () => {
    const result = await createDeterministicCitationVerifier().verify({ claim: claim('Acme reported 20% growth in 2025.'), evidence: evidence('Acme did not report 30% growth in 2024.') })
    expect(result).toMatchObject({ status: 'unsupported', verificationMethod: 'conservative_structural' })
    expect(result.checks.numericTemporal).toBe('contradicted')
  })
})
