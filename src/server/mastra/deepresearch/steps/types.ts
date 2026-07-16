import type { createContentService } from '@server/services/deepresearch/content-service'
import type { createSearchService } from '@server/services/deepresearch/search-service'

export type ReturnTypeOfSearchService = ReturnType<typeof createSearchService>
export type ReturnTypeOfContentService = ReturnType<typeof createContentService>
