export type PlannedIllustrationScene = {
  id: string
  ordinal: number
  title: string
  excerpt: string
  prompt: string
}

type PlanInput = { text: string; imageCount: number; style?: string; aspectRatio?: string }
type ExportJob = { id: string; source_label: string; source_url: string | null; mode: string; config: Record<string, unknown> }
type ExportScene = PlannedIllustrationScene & { status: string; generation_id?: string | null; error_message?: string | null }

export function createIllustrationPlan({ text, imageCount, style = 'editorial illustration', aspectRatio = '1:1' }: PlanInput): PlannedIllustrationScene[] {
  const sections = splitSections(text)
  const count = Math.max(1, Math.min(12, Math.round(imageCount) || 1))
  return Array.from({ length: count }, (_, index) => {
    const section = sections[Math.min(sections.length - 1, Math.floor(index * sections.length / count))]
    const ordinal = index + 1
    const title = section.heading || `Scene ${ordinal}`
    const excerpt = section.text.slice(0, 600)
    return { id: `scene-${ordinal}`, ordinal, title, excerpt, prompt: `Create an ${style} illustration for this article moment: ${excerpt}. Compose for ${aspectRatio}; no text overlay.` }
  })
}

export function renderIllustrationMarkdown(job: ExportJob, scenes: ExportScene[]): string {
  return [
    '# Article illustration plan', '',
    `- Job: ${job.id}`,
    `- Source: ${job.source_label}${job.source_url ? ` (${job.source_url})` : ''}`,
    `- Mode: ${job.mode}`,
    `- Configuration: \`${JSON.stringify(job.config)}\``, '',
    '## Scenes', '',
    ...scenes.flatMap((scene) => [
      `### ${scene.ordinal}. ${scene.title}`,
      '', `> ${scene.excerpt}`, '',
      `**Prompt:** ${scene.prompt}`, '',
      `**Status:** ${scene.status}${scene.generation_id ? ` ¡¤ Image generation: ${scene.generation_id}` : ''}${scene.error_message ? ` ¡¤ Error: ${scene.error_message}` : ''}`,
      '',
    ]),
  ].join('\n')
}

function splitSections(text: string): Array<{ heading?: string; text: string }> {
  const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
  const sections: Array<{ heading?: string; text: string }> = []
  let heading: string | undefined
  for (const paragraph of paragraphs) {
    if (/^#{1,6}\s+/.test(paragraph)) { heading = paragraph.replace(/^#{1,6}\s+/, '').trim(); continue }
    sections.push({ heading, text: paragraph.replace(/\s+/g, ' ').trim() })
    heading = undefined
  }
  return sections.length ? sections : [{ text: text.replace(/\s+/g, ' ').trim() || 'Article illustration' }]
}