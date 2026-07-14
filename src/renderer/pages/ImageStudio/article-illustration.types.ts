export type ArticleIllustrationScene = {
  id: string
  ordinal: number
  title: string
  excerpt: string
  prompt: string
  status: string
  generation_id: string | null
  error_message: string | null
  retry_count: number
}
export type ArticleIllustrationJob = {
  id: string
  source_type: 'text' | 'url' | 'file'
  source_label: string
  source_url: string | null
  article_text: string
  mode: 'skill' | 'fallback'
  skill_version_id: string | null
  run_id: string | null
  image_session_id: string | null
  config: Record<string, unknown>
  status: string
  error_message: string | null
  scenes: ArticleIllustrationScene[]
}
export type EligibleImageSkill = { packageId: string; packageName: string; skillVersionId: string; version: string; requiredCapabilities: string[]; activeImageGrant: { grantMode: string; maxCalls: number | null; allowedModels: string[] | null } | null }
export type ArticleSourceDraft = { text: string; url: string; urlConsent: boolean; filePath?: string; fileName?: string }