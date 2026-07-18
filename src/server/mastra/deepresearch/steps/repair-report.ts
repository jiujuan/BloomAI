import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import type { ReportCritic } from '../agents/report-critic'
import type { DeepResearchRepositories } from '../workflow-context'
import { checkpointWorkflowPhase, isReplayPastPhase } from './checkpoint-replay'
import { loadRunnableRun } from '../workflow-context'

export function createRepairReportStep({ repositories, critic }: { repositories: DeepResearchRepositories; critic: ReportCritic }) {
  return createStep({
    id: 'deep-research-repair-report',
    inputSchema: z.object({ runId: z.string().min(1) }),
    outputSchema: z.object({ runId: z.string().min(1) }),
    execute: async ({ inputData }) => {
      const run = loadRunnableRun(repositories, inputData.runId, ['verifying'])
      if (isReplayPastPhase(run.id, 'repair_report')) return { runId: run.id }
      const sections = repositories.researchReportRepo.listSections(run.id)
      const claims = repositories.researchReportRepo.listClaims(run.id)
      const repairs = await critic.review({ run, sections, claims })
      for (const section of sections) {
        const repair = repairs.find((item) => item.sectionId === section.id)
        const verifiedText = repair ? (section.draft ?? '') + '\n\n' + repair.limitation : (section.draft ?? '')
        repositories.researchReportRepo.updateSection(section.id, { verifiedText, status: repair || !section.draft ? 'limited' : 'verified' })
      }
      checkpointWorkflowPhase(repositories, run, 'repair_report', 'assessing_quality')
      return { runId: run.id }
    },
  })
}
