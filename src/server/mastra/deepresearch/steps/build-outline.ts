import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { getResearchProfilePolicy } from '@server/deepresearch/domain/profiles'
import { researchBriefSchema } from '@shared/deepresearch/schemas'
import type { DeepResearchRepositories } from '../workflow-context'
import { checkpointWorkflowPhase, isReplayPastPhase } from './checkpoint-replay'
import { loadRunnableRun } from '../workflow-context'

const inputSchema = z.object({ runId: z.string().min(1), brief: researchBriefSchema })
export const reportSectionJobSchema = z.object({ runId: z.string().min(1), sectionId: z.string().min(1) })

function toSectionKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function createBuildOutlineStep(repositories: DeepResearchRepositories) {
  return createStep({
    id: 'deep-research-build-outline',
    inputSchema,
    outputSchema: z.array(reportSectionJobSchema),
    execute: async ({ inputData }) => {
      const run = loadRunnableRun(repositories, inputData.runId, ['planning'])
      if (isReplayPastPhase(run.id, 'building_outline')) {
        const jobs = repositories.researchReportRepo.listSections(run.id).map((section) => ({ runId: run.id, sectionId: section.id }))
        repositories.researchRunRepo.transitionWithEvent(run.id, 'researching', { phase: 'building_outline', progress: 68 })
        checkpointWorkflowPhase(repositories, run, 'building_outline', 'drafting_sections', { pendingSectionIds: jobs.map((job) => job.sectionId) })
        return jobs
      }
      const required = getResearchProfilePolicy(run.profile).requiredSections
      const plannedQuestionSections = (inputData.brief.questions ?? []).map((question) => question.sectionKey)
      const titles = [...new Set([...required, ...inputData.brief.plannedSections, ...plannedQuestionSections].map((title) => title.trim()).filter(Boolean))]
      const existing = repositories.researchReportRepo.listSections(run.id)
      const questions = repositories.researchQuestionRepo.list(run.id).filter((question) => question.questionType !== 'clarification')
      const jobs = titles.map((title, index) => {
        const sectionKey = toSectionKey(title)
        const section = existing.find((item) => item.sectionKey === sectionKey || (!item.sectionKey && toSectionKey(item.title) === sectionKey))
          ?? repositories.researchReportRepo.upsertSection({
            runId: run.id,
            ordinal: index + 1,
            sectionKey,
            title,
            purpose: required.includes(title) ? 'Required by the frozen ' + run.profile + ' profile.' : 'Planned by the topic-specific research brief.',
            status: 'planned',
            idempotencyKey: 'report-section:v2:' + sectionKey,
          })
        repositories.researchReportRepo.replaceSectionQuestionMappings({
          runId: run.id,
          sectionId: section.id,
          questionIds: questions.filter((question) => question.sectionKey === sectionKey).map((question) => question.id),
        })
        return { runId: run.id, sectionId: section.id }
      })
      repositories.researchRunRepo.transitionWithEvent(run.id, 'researching', { phase: 'building_outline', progress: 68 })
      checkpointWorkflowPhase(repositories, run, 'building_outline', 'drafting_sections', { pendingSectionIds: jobs.map((job) => job.sectionId) })
      return jobs
    },
  })
}
