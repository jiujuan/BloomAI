import { and, eq } from 'drizzle-orm'
import { getOrmDb } from '../../db/client'
import { articleIllustrationRepo, type ArticleIllustrationScene } from '../../db/repositories/article-illustration.repo'
import { skillPackageRepo } from '../../db/repositories/skill-package.repo'
import { skill_installations, skill_packages, skill_versions } from '../../db/schema'
import { imageSessionRepo } from '../../db/repositories/image-session.repo'
import { generateForSession } from '../../services/image-studio.service'
import { executeCapability } from '../policy/capability-broker'
import { SkillRunCoordinator } from '../runtime'
import { extractArticle, type ArticleSourceInput } from './article-source'
import { createIllustrationPlan, renderIllustrationMarkdown } from './illustration-planner'

export type ArticleIllustrationConfig = { imageCount?: number; model?: string; aspectRatioId?: string; styleId?: string; [key: string]: unknown }
export type EligibleImageSkill = {
  packageId: string
  packageName: string
  skillVersionId: string
  version: string
  requiredCapabilities: string[]
  activeImageGrant: { grantMode: string; maxCalls: number | null; allowedModels: string[] | null } | null
}

function manifestCapabilities(raw: string): string[] {
  try {
    const manifest = JSON.parse(raw) as { capabilities?: unknown; capability?: unknown; permissions?: unknown }
    const capabilities = manifest.capabilities ?? manifest.capability ?? manifest.permissions ?? []
    if (Array.isArray(capabilities)) return capabilities.filter((entry): entry is string => typeof entry === 'string')
    return capabilities && typeof capabilities === 'object'
      ? Object.entries(capabilities as Record<string, unknown>).filter(([, enabled]) => enabled === true).map(([capability]) => capability)
      : []
  } catch { return [] }
}

function activeImageGrant(skillVersionId: string): EligibleImageSkill['activeImageGrant'] {
  const now = Date.now()
  const grant = skillPackageRepo.listCapabilityGrants(skillVersionId).find((candidate) =>
    candidate.capability === 'image.generate'
    && candidate.revoked_at === null
    && candidate.consumed_at === null
    && (candidate.expires_at === null || candidate.expires_at > now),
  )
  if (!grant) return null
  try {
    const scope = JSON.parse(grant.scope_json) as { maxCalls?: unknown; allowedModels?: unknown }
    return {
      grantMode: grant.grant_mode,
      maxCalls: typeof scope.maxCalls === 'number' ? scope.maxCalls : null,
      allowedModels: Array.isArray(scope.allowedModels) ? scope.allowedModels.filter((model): model is string => typeof model === 'string') : null,
    }
  } catch { return null }
}

function defaultModel(job: { config: Record<string, unknown> }): string {
  const model = job.config.model
  return typeof model === 'string' && model.trim() ? model : 'agnes-image-2.1-flash'
}

export const articleIllustrationService = {
  listEligibleSkills(): EligibleImageSkill[] {
    return getOrmDb().select({ version: skill_versions, package: skill_packages }).from(skill_installations)
      .innerJoin(skill_versions, eq(skill_installations.current_version_id, skill_versions.id))
      .innerJoin(skill_packages, eq(skill_installations.package_id, skill_packages.id))
      .where(and(eq(skill_installations.enabled, 1), eq(skill_installations.status, 'installed'))).all()
      .map(({ version, package: pkg }) => ({ version, pkg, capabilities: manifestCapabilities(version.manifest_json) }))
      .filter(({ capabilities }) => capabilities.includes('image.generate'))
      .map(({ version, pkg, capabilities }) => ({
        packageId: pkg.id,
        packageName: pkg.name,
        skillVersionId: version.id,
        version: version.version,
        requiredCapabilities: capabilities,
        activeImageGrant: activeImageGrant(version.id),
      }))
  },

  async createPlan(input: { source: ArticleSourceInput; mode: 'skill' | 'fallback'; skillVersionId?: string; config?: ArticleIllustrationConfig }) {
    const article = await extractArticle(input.source)
    const config = input.config ?? {}
    if (input.mode === 'skill' && (!input.skillVersionId || !this.listEligibleSkills().some((skill) => skill.skillVersionId === input.skillVersionId))) {
      throw Object.assign(new Error('Select an enabled Package Skill that declares image.generate.'), { code: 'ELIGIBLE_SKILL_REQUIRED' })
    }
    const job = articleIllustrationRepo.createJob({
      sourceType: article.sourceType, sourceLabel: article.sourceLabel, sourceUrl: article.sourceUrl, articleText: article.text,
      mode: input.mode, skillVersionId: input.mode === 'skill' ? input.skillVersionId : null, config,
    })
    const plan = createIllustrationPlan({ text: article.text, imageCount: Number(config.imageCount ?? 3), style: String(config.styleId ?? 'editorial illustration'), aspectRatio: String(config.aspectRatioId ?? '1:1') })
    const scenes = articleIllustrationRepo.replaceScenes(job.id, plan.map(({ ordinal, title, excerpt, prompt }) => ({ ordinal, title, excerpt, prompt })))
    if (input.mode === 'skill') {
      const coordinator = new SkillRunCoordinator()
      const { runId } = coordinator.startRun({
        skillVersionId: input.skillVersionId!,
        surface: 'image',
        input: { source: { type: article.sourceType, label: article.sourceLabel, url: article.sourceUrl }, articleText: article.text, scenes, config },
        context: { surface: 'article-illustration', jobId: job.id },
      })
      const run = coordinator.getRun(runId)
      coordinator.transition(runId, 'waiting_approval', {
        expectedRevision: run.revision,
        waitingReason: `Review the ${scenes.length}-image illustration plan before generation.`,
        approvalCapabilities: ['image.generate'],
      })
      articleIllustrationRepo.updateJob(job.id, { runId, status: 'waiting_approval' })
    }
    return this.getJob(job.id)!
  },

  getJob(id: string) {
    const job = articleIllustrationRepo.getJob(id)
    return job ? { ...job, scenes: articleIllustrationRepo.listScenes(id) } : undefined
  },

  updateScene(jobId: string, sceneId: string, patch: Partial<Pick<ArticleIllustrationScene, 'ordinal' | 'title' | 'excerpt' | 'prompt'>>) {
    if (!articleIllustrationRepo.getJob(jobId)) return undefined
    return articleIllustrationRepo.updateScene(jobId, sceneId, patch)
  },

  replacePlan(jobId: string, scenes: Array<{ ordinal: number; title: string; excerpt: string; prompt: string }>) {
    if (!articleIllustrationRepo.getJob(jobId)) return undefined
    return articleIllustrationRepo.replaceScenes(jobId, scenes)
  },

  async confirmPlan(jobId: string) {
    const job = articleIllustrationRepo.getJob(jobId)
    if (!job) return undefined
    const scenes = articleIllustrationRepo.listScenes(jobId)
    if (!scenes.length) throw Object.assign(new Error('Add at least one illustration scene before confirming.'), { code: 'EMPTY_ILLUSTRATION_PLAN' })
    const existingSession = job.image_session_id
      ? imageSessionRepo.get(job.image_session_id)
      : undefined
    const imageSession = existingSession
      ?? imageSessionRepo.create({ title: job.source_label, default_model: defaultModel(job) })
    if (job.mode === 'skill') {
      if (!job.run_id) throw Object.assign(new Error('The Package Skill run is missing.'), { code: 'SKILL_RUN_MISSING' })
      const coordinator = new SkillRunCoordinator()
      const run = coordinator.getRun(job.run_id)
      if (run.status === 'running') return this.getJob(jobId)!
      if (run.status !== 'waiting_approval') throw Object.assign(new Error(`The Package Skill run cannot be confirmed from ${run.status}.`), { code: 'SKILL_RUN_NOT_WAITING_APPROVAL' })
      coordinator.dispatchCommand(run.id, { type: 'confirm', idempotencyKey: `article-confirm-${jobId}-${run.revision}`, expectedRevision: run.revision })
      articleIllustrationRepo.updateJob(jobId, { imageSessionId: imageSession.id, status: 'running', errorMessage: null })
      void this.generateWithSkill(jobId, imageSession.id).catch((error) => this.failSkillRun(jobId, error))
    } else {
      articleIllustrationRepo.updateJob(jobId, { imageSessionId: imageSession.id, status: 'running', errorMessage: null })
      void this.generateFallback(jobId, imageSession.id).catch((error) => articleIllustrationRepo.updateJob(jobId, { status: 'failed', errorMessage: error instanceof Error ? error.message : 'Image generation failed' }))
    }
    return this.getJob(jobId)!
  },

  async retryScene(jobId: string, sceneId: string) {
    const job = articleIllustrationRepo.getJob(jobId)
    const scene = articleIllustrationRepo.listScenes(jobId).find((candidate) => candidate.id === sceneId)
    if (!job || !scene) return undefined
    if (!job.image_session_id) throw Object.assign(new Error('Confirm the illustration plan before retrying a scene.'), { code: 'ILLUSTRATION_NOT_STARTED' })
    articleIllustrationRepo.incrementSceneRetry(jobId, sceneId)
    articleIllustrationRepo.updateScene(jobId, sceneId, { status: 'planned', error_message: null })
    articleIllustrationRepo.updateJob(jobId, { status: 'running', errorMessage: null })
    const generator = job.mode === 'skill' ? this.generateSkillScene(jobId, job.image_session_id, sceneId) : this.generateFallbackScene(jobId, job.image_session_id, sceneId)
    void generator.then(() => this.finishJobFromScenes(jobId)).catch((error) => articleIllustrationRepo.updateJob(jobId, { status: 'failed', errorMessage: error instanceof Error ? error.message : 'Image generation failed' }))
    return this.getJob(jobId)!
  },

  resume(jobId: string) {
    const job = articleIllustrationRepo.getJob(jobId)
    if (!job) return undefined
    if (job.mode === 'skill' && job.run_id) {
      const coordinator = new SkillRunCoordinator()
      const run = coordinator.getRun(job.run_id)
      if (run.status === 'interrupted') {
        const validating = coordinator.resumeRun(run.id, { expectedRevision: run.revision })
        coordinator.transition(run.id, 'waiting_approval', { expectedRevision: validating.revision, waitingReason: 'The prior run was interrupted. Review the plan before restarting generation.', approvalCapabilities: ['image.generate'] })
      }
    }
    articleIllustrationRepo.updateJob(jobId, { status: 'waiting_approval', errorMessage: null })
    return this.getJob(jobId)!
  },

  listRecoverable() {
    return articleIllustrationRepo.listRecoverable().map((job) => {
      if (job.mode === 'skill' && job.run_id) {
        try {
          const run = new SkillRunCoordinator().getRun(job.run_id)
          if (run.status === 'interrupted' && job.status !== 'interrupted') articleIllustrationRepo.updateJob(job.id, { status: 'interrupted', errorMessage: run.errorMessage })
        } catch { /* The job remains recoverable even if its historic Run was removed. */ }
      }
      return this.getJob(job.id)!
    })
  },

  exportMarkdown(jobId: string) {
    const detail = this.getJob(jobId)
    return detail ? renderIllustrationMarkdown(detail, detail.scenes) : undefined
  },

  async generateWithSkill(jobId: string, sessionId: string) {
    for (const scene of articleIllustrationRepo.listScenes(jobId)) await this.generateSkillScene(jobId, sessionId, scene.id)
    this.finishSkillRun(jobId)
  },

  async generateSkillScene(jobId: string, sessionId: string, sceneId: string) {
    const job = articleIllustrationRepo.getJob(jobId)
    const scene = articleIllustrationRepo.listScenes(jobId).find((candidate) => candidate.id === sceneId)
    if (!job?.run_id || !scene) return
    articleIllustrationRepo.updateScene(jobId, sceneId, { status: 'running', error_message: null })
    try {
      const result = await executeCapability({
        caller: 'package-runtime',
        capability: 'image.generate',
        runId: job.run_id,
        input: { prompt: scene.prompt, model: defaultModel(job), imageSessionId: sessionId, title: job.source_label, aspectRatioId: typeof job.config.aspectRatioId === 'string' ? job.config.aspectRatioId : undefined, styleId: typeof job.config.styleId === 'string' ? job.config.styleId : undefined },
      })
      const output = result.output as { imageSessionId?: unknown; item?: { generationId?: unknown; status?: unknown; error?: unknown } }
      const item = output.item
      articleIllustrationRepo.updateScene(jobId, sceneId, {
        status: item?.status === 'completed' ? 'completed' : 'failed',
        generation_id: typeof item?.generationId === 'string' ? item.generationId : null,
        error_message: item?.status === 'completed' ? null : typeof item?.error === 'string' ? item.error : 'Image generation failed',
      })
      if (typeof output.imageSessionId === 'string') articleIllustrationRepo.updateJob(jobId, { imageSessionId: output.imageSessionId })
    } catch (error) {
      articleIllustrationRepo.updateScene(jobId, sceneId, { status: 'failed', error_message: error instanceof Error ? error.message : 'Image generation failed' })
    }
  },

  async failSkillRun(jobId: string, error: unknown) {
    const message = error instanceof Error ? error.message : 'Image generation failed'
    const job = articleIllustrationRepo.getJob(jobId)
    if (job?.run_id) {
      try {
        const coordinator = new SkillRunCoordinator()
        const run = coordinator.getRun(job.run_id)
        if (run.status === 'running') coordinator.transition(run.id, 'failed', { expectedRevision: run.revision, errorCode: 'ARTICLE_ILLUSTRATION_FAILED', errorMessage: message })
      } catch { /* Persist the job failure even if its historic Run cannot be updated. */ }
    }
    articleIllustrationRepo.updateJob(jobId, { status: 'failed', errorMessage: message })
  },

  finishSkillRun(jobId: string) {
    const job = articleIllustrationRepo.getJob(jobId)
    if (!job) return
    const scenes = articleIllustrationRepo.listScenes(jobId)
    const status = scenes.every((scene) => scene.status === 'completed') ? 'completed' : 'completed_with_errors'
    if (job.run_id) {
      const coordinator = new SkillRunCoordinator()
      const run = coordinator.getRun(job.run_id)
      if (run.status === 'running') coordinator.transition(run.id, status, { expectedRevision: run.revision, output: { imageSessionId: job.image_session_id, scenes: scenes.map((scene) => ({ id: scene.id, status: scene.status, generationId: scene.generation_id, error: scene.error_message })) } })
    }
    articleIllustrationRepo.updateJob(jobId, { status, errorMessage: status === 'completed' ? null : 'One or more illustration scenes failed.' })
  },

  async generateFallback(jobId: string, sessionId: string) {
    for (const scene of articleIllustrationRepo.listScenes(jobId)) await this.generateFallbackScene(jobId, sessionId, scene.id)
    this.finishJobFromScenes(jobId)
  },

  async generateFallbackScene(jobId: string, sessionId: string, sceneId: string) {
    const job = articleIllustrationRepo.getJob(jobId)
    const scene = articleIllustrationRepo.listScenes(jobId).find((candidate) => candidate.id === sceneId)
    if (!job || !scene) return
    articleIllustrationRepo.updateScene(jobId, sceneId, { status: 'running', error_message: null })
    try {
      const generation = await generateForSession({ sessionId, prompt: scene.prompt, model: defaultModel(job), aspectRatioId: typeof job.config.aspectRatioId === 'string' ? job.config.aspectRatioId : undefined, styleId: typeof job.config.styleId === 'string' ? job.config.styleId : undefined })
      articleIllustrationRepo.updateScene(jobId, sceneId, { status: generation.status === 'completed' ? 'completed' : 'failed', generation_id: generation.id, error_message: generation.error_msg })
    } catch (error) {
      articleIllustrationRepo.updateScene(jobId, sceneId, { status: 'failed', error_message: error instanceof Error ? error.message : 'Image generation failed' })
    }
  },

  finishJobFromScenes(jobId: string) {
    const scenes = articleIllustrationRepo.listScenes(jobId)
    articleIllustrationRepo.updateJob(jobId, { status: scenes.every((scene) => scene.status === 'completed') ? 'completed' : 'completed_with_errors' })
  },
}
