import { createStep } from '@mastra/core/workflows'
import type { SectionWriter } from '../agents/section-writer'
import { reportSectionJobSchema } from './build-outline'
import type { DeepResearchRepositories } from '../workflow-context'
import { loadRunnableRun } from '../workflow-context'
import { selectEvidenceForSection } from './section-evidence'

export function createDraftSectionsStep({ repositories, writer }: { repositories: DeepResearchRepositories; writer: SectionWriter }) {
  return createStep({
    id: 'deep-research-draft-sections',
    inputSchema: reportSectionJobSchema,
    outputSchema: reportSectionJobSchema,
    execute: async ({ inputData }) => {
      const run = loadRunnableRun(repositories, inputData.runId, ['researching'])
      const section = repositories.researchReportRepo.listSections(run.id).find((item) => item.id === inputData.sectionId)
      if (!section) throw new Error('Deep Research section not found: ' + inputData.sectionId)
      const questions = repositories.researchQuestionRepo.list(run.id)
      const evidence = selectEvidenceForSection(section, questions, repositories.researchEvidenceRepo.list(run.id))
      const draft = await writer.draft({ run, section, evidence })
      repositories.researchReportRepo.updateSection(section.id, { draft, status: 'drafted' })
      repositories.researchEventRepo.append({ runId: run.id, type: 'research.section.drafted', phase: 'drafting_sections', payload: { id: section.id } })
      return inputData
    },
  })
}
