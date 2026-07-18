import { describe, expect, it } from 'vitest'
import type { ResearchEvidenceDto, ResearchQuestionDto, ResearchReportSectionDto } from '@shared/deepresearch/contracts'
import { selectEvidenceForSection } from './section-evidence'

const section: ResearchReportSectionDto = {
  id: 'section-data', runId: 'run-1', ordinal: 1, sectionKey: 'data-and-workflows', title: 'data-and-workflows', purpose: 'Data source analysis.', draft: null, verifiedText: null, status: 'planned',
}

const questions: ResearchQuestionDto[] = [
  { id: 'q-data-sources', runId: 'run-1', parentQuestionId: null, ordinal: 1, question: 'Which data sources are used?', intent: 'data sources', requiredEvidenceTypes: [], priority: 'high', status: 'covered', coverage: null, sectionKey: 'data-and-workflows' },
  { id: 'q-buyer-workflows', runId: 'run-1', parentQuestionId: null, ordinal: 2, question: 'Which buyer workflows benefit?', intent: 'buyer workflows', requiredEvidenceTypes: [], priority: 'medium', status: 'covered', coverage: null, sectionKey: 'data-and-workflows' },
  { id: 'q-risks', runId: 'run-1', parentQuestionId: null, ordinal: 3, question: 'What risks apply?', intent: 'risks', requiredEvidenceTypes: [], priority: 'high', status: 'covered', coverage: null, sectionKey: 'risks-and-limitations' },
]

const evidence: ResearchEvidenceDto[] = [
  { id: 'e-data', runId: 'run-1', questionId: 'q-data-sources', snapshotId: 's-1', passage: 'Data evidence', summary: 'Data', stance: 'supporting', confidence: 0.9, startOffset: 0, endOffset: 13 },
  { id: 'e-workflow', runId: 'run-1', questionId: 'q-buyer-workflows', snapshotId: 's-2', passage: 'Workflow evidence', summary: 'Workflow', stance: 'supporting', confidence: 0.9, startOffset: 0, endOffset: 17 },
  { id: 'e-risk', runId: 'run-1', questionId: 'q-risks', snapshotId: 's-3', passage: 'Risk evidence', summary: 'Risk', stance: 'supporting', confidence: 0.9, startOffset: 0, endOffset: 13 },
]

describe('selectEvidenceForSection', () => {
  it('uses the explicit one-to-many section mapping and never broadcasts evidence from other questions', () => {
    expect(selectEvidenceForSection(section, questions, evidence, ['q-data-sources', 'q-buyer-workflows']).map((item) => item.id)).toEqual(['e-data', 'e-workflow'])
  })
})
