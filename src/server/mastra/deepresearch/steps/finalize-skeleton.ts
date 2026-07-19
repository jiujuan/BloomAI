import fs from 'fs'
import path from 'path'
import { createStep } from '@mastra/core/workflows'
import { z } from 'zod'
import { researchBriefSchema } from '@shared/deepresearch/schemas'
import { getDataDir } from '@server/db/paths'
import type { DeepResearchRepositories } from '../workflow-context'
import { loadRunnableRun } from '../workflow-context'

const inputSchema = z.object({
  runId: z.string().min(1),
  brief: researchBriefSchema,
})
const outputSchema = z.object({ runId: z.string().min(1), artifactId: z.string().min(1) })

function createSkeletonMarkdown(brief: z.infer<typeof inputSchema>['brief']): string {
  const sections = brief.plannedSections
    .map((section) => '## ' + section + '\n\nResearch content will be added in the subsequent evidence pipeline.')
    .join('\n\n')
  return [
    '# ' + brief.title,
    '',
    '## Research status',
    '',
    'This is a persisted research skeleton. Evidence collection, drafting, and citation verification are pending.',
    '',
    '## Scope',
    '',
    brief.scope,
    '',
    sections,
    '',
    '## Limitations',
    '',
    'The current run completed its planning skeleton before source retrieval and report verification.',
    '',
  ].join('\n')
}

export function createFinalizeSkeletonStep(repositories: DeepResearchRepositories, dataDir = getDataDir()) {
  return createStep({
    id: 'deep-research-finalize-skeleton',
    inputSchema,
    outputSchema,
    execute: async ({ inputData }) => {
      const run = loadRunnableRun(repositories, inputData.runId, ['planning'])
      for (const [ordinal, title] of inputData.brief.plannedSections.entries()) {
        repositories.researchReportRepo.upsertSection({
          runId: run.id,
          ordinal: ordinal + 1,
          title,
          purpose: 'Planned by the Deep Research brief.',
          status: 'planned',
          idempotencyKey: 'skeleton-section:v1:' + (ordinal + 1),
        })
      }

      const markdown = createSkeletonMarkdown(inputData.brief)
      const artifactDirectory = path.join(dataDir, 'deepresearch', 'runs', run.id)
      const artifactPath = path.join(artifactDirectory, 'research-skeleton.md')
      fs.mkdirSync(artifactDirectory, { recursive: true })
      fs.writeFileSync(artifactPath, markdown, 'utf8')

      const existingArtifact = repositories.researchReportRepo.listArtifacts(run.id).find((artifact) => artifact.type === 'report_markdown' && artifact.fileName === 'research-skeleton.md')
      const artifact = repositories.researchReportRepo.upsertArtifact({
        runId: run.id,
        type: 'report_markdown',
        fileName: 'research-skeleton.md',
        contentType: 'text/markdown',
        storagePath: artifactPath,
        sizeBytes: Buffer.byteLength(markdown),
        metadata: { phase: 'skeleton_complete' },
        idempotencyKey: 'skeleton-markdown:v1',
      })
      if (!existingArtifact) {
        repositories.researchEventRepo.append({
          runId: run.id,
          type: 'research.artifact.created',
          phase: 'skeleton_complete',
          payload: { id: artifact.id },
        })
      }

      repositories.researchRunRepo.transitionWithEvent(run.id, 'researching', { phase: 'skeleton_research', progress: 55 })
      repositories.researchRunRepo.transitionWithEvent(run.id, 'synthesizing', { phase: 'skeleton_synthesis', progress: 70 })
      repositories.researchRunRepo.transitionWithEvent(run.id, 'verifying', { phase: 'skeleton_verification', progress: 85 })
      repositories.researchRunRepo.transitionWithEvent(run.id, 'completed_with_limitations', {
        phase: 'skeleton_complete',
        progress: 100,
        eventType: 'research.run.completed',
        eventPayload: { releaseStatus: 'completed_with_limitations' },
      })

      return { runId: run.id, artifactId: artifact.id }
    },
  })
}
