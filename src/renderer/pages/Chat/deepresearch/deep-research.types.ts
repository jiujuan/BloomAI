import type {
  ResearchEvidenceDto,
  ResearchQuestionDto,
  ResearchReportDto,
  ResearchSourceDto,
  StartResearchInput,
} from '@shared/deepresearch/contracts'

export const DEEP_RESEARCH_VIEWS = [
  'overview',
  'questions',
  'sources',
  'report',
  'evidence',
  'activity',
] as const

export type DeepResearchView = (typeof DEEP_RESEARCH_VIEWS)[number]
export type DeepResearchDraft = StartResearchInput

export interface DeepResearchCollections {
  questions: ResearchQuestionDto[]
  sources: ResearchSourceDto[]
  report: ResearchReportDto | null
  evidenceById: Record<string, ResearchEvidenceDto>
}
