import { describe, expect, it } from 'vitest'
import type { ResearchQuestionDto } from '@shared/deepresearch/contracts'
import { resolveSectionQuestionMappings } from './build-outline'

const questions: ResearchQuestionDto[] = [
  { id: 'q-high', runId: 'run-1', parentQuestionId: null, ordinal: 1, question: 'What is the current market?', intent: 'market', requiredEvidenceTypes: [], priority: 'high', status: 'planned', coverage: null, sectionKey: 'market-definition' },
  { id: 'q-medium', runId: 'run-1', parentQuestionId: null, ordinal: 2, question: 'Who are the buyers?', intent: 'buyers', requiredEvidenceTypes: [], priority: 'medium', status: 'planned', coverage: null, sectionKey: 'customer-segments' },
  { id: 'q-risk', runId: 'run-1', parentQuestionId: null, ordinal: 3, question: 'What are the risks?', intent: 'risks', requiredEvidenceTypes: [], priority: 'high', status: 'planned', coverage: null, sectionKey: 'risks-and-limitations' },
]

describe('resolveSectionQuestionMappings', () => {
  it('uses explicit persisted mappings for fixed sections without broadcasting evidence at write time', () => {
    expect(resolveSectionQuestionMappings('executive-summary', questions)).toEqual(['q-high', 'q-risk'])
    expect(resolveSectionQuestionMappings('findings-by-question', questions)).toEqual(['q-high', 'q-medium', 'q-risk'])
    expect(resolveSectionQuestionMappings('scope-and-method', questions)).toEqual([])
    expect(resolveSectionQuestionMappings('market-definition', questions)).toEqual(['q-high'])
  })
})
