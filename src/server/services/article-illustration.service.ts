import { ArticleSourceError } from '../skills/article-illustrations/article-source'
import {
  articleIllustrationService as articleIllustrationRuntime,
  type ArticleIllustrationConfig,
} from '../skills/article-illustrations/article-illustration.service'
import { isServiceError, ServiceError, type ServiceErrorCode } from './errors'

const ARTICLE_SOURCE_CODES = new Set<ServiceErrorCode>([
  'ARTICLE_TEXT_TOO_LONG',
  'URL_CONSENT_REQUIRED',
  'URL_NOT_ALLOWED',
  'ARTICLE_FETCH_FAILED',
  'UNSUPPORTED_ARTICLE_FILE',
  'ARTICLE_FILE_UNREADABLE',
  'ARTICLE_FILE_TOO_LARGE',
])

const ARTICLE_ILLUSTRATION_CODES = new Set<ServiceErrorCode>([
  'ELIGIBLE_SKILL_REQUIRED',
  'EMPTY_ILLUSTRATION_PLAN',
  'SKILL_RUN_MISSING',
  'SKILL_RUN_NOT_WAITING_APPROVAL',
  'ILLUSTRATION_NOT_STARTED',
])

type ArticleIllustrationRuntime = typeof articleIllustrationRuntime
type ArticleIllustrationServiceDependencies = {
  runtime: ArticleIllustrationRuntime
}

export function createArticleIllustrationService(overrides: Partial<ArticleIllustrationServiceDependencies> = {}) {
  const dependencies: ArticleIllustrationServiceDependencies = {
    runtime: articleIllustrationRuntime,
    ...overrides,
  }

  return {
    listEligibleSkills() {
      return invoke(() => dependencies.runtime.listEligibleSkills())
    },

    listRecoverable() {
      return invoke(() => dependencies.runtime.listRecoverable())
    },

    getJob(id: string) {
      return requireValue(invoke(() => dependencies.runtime.getJob(id)), 'Article illustration job not found')
    },

    exportMarkdown(id: string) {
      return requireValue(invoke(() => dependencies.runtime.exportMarkdown(id)), 'Article illustration job not found')
    },

    async createPlan(input: { source: Parameters<ArticleIllustrationRuntime['createPlan']>[0]['source']; mode: 'skill' | 'fallback'; skillVersionId?: string; config?: ArticleIllustrationConfig }) {
      return invokeAsync(() => dependencies.runtime.createPlan(input))
    },

    replacePlan(jobId: string, scenes: Parameters<ArticleIllustrationRuntime['replacePlan']>[1]) {
      return requireValue(invoke(() => dependencies.runtime.replacePlan(jobId, scenes)), 'Article illustration job not found')
    },

    updateScene(jobId: string, sceneId: string, patch: Parameters<ArticleIllustrationRuntime['updateScene']>[2]) {
      return requireValue(invoke(() => dependencies.runtime.updateScene(jobId, sceneId, patch)), 'Article illustration scene not found')
    },

    async confirmPlan(jobId: string) {
      return requireValue(await invokeAsync(() => dependencies.runtime.confirmPlan(jobId)), 'Article illustration job not found')
    },

    async retryScene(jobId: string, sceneId: string) {
      return requireValue(await invokeAsync(() => dependencies.runtime.retryScene(jobId, sceneId)), 'Article illustration scene not found')
    },

    resume(jobId: string) {
      return requireValue(invoke(() => dependencies.runtime.resume(jobId)), 'Article illustration job not found')
    },
  }
}

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new ServiceError('NOT_FOUND', message)
  return value
}

function invoke<T>(operation: () => T): T {
  try {
    return operation()
  } catch (error) {
    throw toArticleIllustrationServiceError(error)
  }
}

async function invokeAsync<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw toArticleIllustrationServiceError(error)
  }
}

function toArticleIllustrationServiceError(error: unknown): ServiceError {
  if (isServiceError(error)) return error
  if (error instanceof ArticleSourceError) {
    const code = ARTICLE_SOURCE_CODES.has(error.code as ServiceErrorCode)
      ? error.code as ServiceErrorCode
      : 'ARTICLE_ILLUSTRATION_ERROR'
    return new ServiceError(code, error.message, {
      canPasteText: error.code === 'ARTICLE_FETCH_FAILED' || error.code === 'URL_NOT_ALLOWED',
    })
  }

  const code = error && typeof error === 'object' && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined
  if (typeof code === 'string' && ARTICLE_ILLUSTRATION_CODES.has(code as ServiceErrorCode)) {
    return new ServiceError(code as ServiceErrorCode, messageOf(error, 'Article illustration operation failed'))
  }
  return new ServiceError('ARTICLE_ILLUSTRATION_ERROR', 'Article illustration operation failed')
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export const articleIllustrationService = createArticleIllustrationService()
