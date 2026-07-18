import type {
  ResearchEvidenceDto,
  ResearchQuestionDto,
  ResearchReportDto,
  ResearchRunLifecycleDto,
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
export type DeepResearchLifecycle = ResearchRunLifecycleDto | null

export interface DeepResearchCollections {
  questions: ResearchQuestionDto[]
  sources: ResearchSourceDto[]
  report: ResearchReportDto | null
  evidenceById: Record<string, ResearchEvidenceDto>
}