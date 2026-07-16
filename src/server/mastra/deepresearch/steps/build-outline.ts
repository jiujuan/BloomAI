import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { getResearchProfilePolicy } from '@server/deepresearch/domain/profiles'
import type { DeepResearchRepositories } from '../workflow-context'
import { loadRunnableRun } from '../workflow-context'

const inputSchema = z.object({ runId: z.string().min(1), brief: z.object({ title: z.string(), objective: z.string().nullable(), audience: z.string().nullable(), scope: z.string(), assumptions: z.array(z.string()), plannedSections: z.array(z.string()), criticalClarificationIds: z.array(z.string()) }) })
export const reportSectionJobSchema = z.object({ runId: z.string().min(1), sectionId: z.string().min(1) })

export function createBuildOutlineStep(repositories: DeepResearchRepositories) {
  return createStep({
    id: 'deep-research-build-outline',
    inputSchema,
    outputSchema: z.array(reportSectionJobSchema),
    execute: async ({ inputData }) => {
      const run = loadRunnableRun(repositories, inputData.runId, ['planning'])
      const required = getResearchProfilePolicy(run.profile).requiredSections
      const titles = [...new Set([...required, ...inputData.brief.plannedSections].map((title) => title.trim()).filter(Boolean))]
      const existing = repositories.researchReportRepo.listSections(run.id)
      const jobs = titles.map((title, index) => {
        const section = existing.find((item) => item.title === title) ?? repositories.researchReportRepo.upsertSection({
          runId: run.id,
          ordinal: index + 1,
          title,
          purpose: required.includes(title) ? 'Required by the frozen ' + run.profile + ' profile.' : 'Planned by the research brief.',
          status: 'planned',
          idempotencyKey: 'report-section:v1:' + (index + 1) + ':' + title,
        })
        return { runId: run.id, sectionId: section.id }
      })
      repositories.researchRunRepo.transitionWithEvent(run.id, 'researching', { phase: 'building_outline', progress: 68 })
      return jobs
    },
  })
}
