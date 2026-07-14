import React, { useEffect, useMemo } from 'react'
import { platform } from '@renderer/api'
import { useImageStore, useLlmStore } from '@renderer/store'
import { ASPECT_RATIOS, IMAGE_STYLES } from '@shared/image-gen'
import { GenerationCard } from './parts/GenerationCard'
import { useArticleIllustrationStore } from './article-illustration.store'

export function ArticleIllustrationWorkbench() {
  const state = useArticleIllustrationStore()
  const imageModels = useLlmStore((store) => store.imageModels)
  const loadGenerations = useImageStore((store) => store.loadGenerations)
  const generationsBySession = useImageStore((store) => store.generationsBySession)
  const activeSessionId = state.activeJob?.image_session_id
  const selectedSkill = state.eligibleSkills.find((skill) => skill.skillVersionId === state.selectedSkillVersionId)
  const generatedById = useMemo(() => new Map((activeSessionId ? generationsBySession[activeSessionId] ?? [] : []).map((generation) => [generation.id, generation])), [activeSessionId, generationsBySession])

  useEffect(() => { void state.loadEligibleSkills(); void state.loadRecoverable() }, [])
  useEffect(() => { if (activeSessionId) void loadGenerations(activeSessionId) }, [activeSessionId, loadGenerations])
  useEffect(() => {
    if (state.activeJob?.status !== 'running') return
    const timer = window.setInterval(() => { void state.refreshJob(); if (activeSessionId) void loadGenerations(activeSessionId) }, 1800)
    return () => window.clearInterval(timer)
  }, [state.activeJob?.status, activeSessionId, loadGenerations])

  const upload = async (file?: File) => {
    if (!file) return
    try {
      const [attachment] = await platform.uploadAttachments([file])
      state.setSource({ filePath: (attachment as any).path, fileName: attachment.name, text: '', url: '' })
    } catch (error) { state.setSource({ fileName: error instanceof Error ? error.message : 'Upload failed' }) }
  }
  const exportMarkdown = async () => {
    if (!state.activeJob) return
    const text = await platform.articleIllustrations.exportMarkdown(state.activeJob.id)
    const blob = new Blob([text], { type: 'text/markdown' })
    const anchor = document.createElement('a')
    anchor.href = URL.createObjectURL(blob)
    anchor.download = 'article-illustrations.md'
    anchor.click()
    URL.revokeObjectURL(anchor.href)
  }

  return <main className="article-illustration" aria-live="polite">
    <section className="article-card">
      <h2>Article illustration</h2>
      <p>Choose a source, review the editable scene plan, then confirm generation.</p>
      <label>Paste article text<textarea value={state.source.text} onChange={(event) => state.setSource({ text: event.target.value, filePath: undefined, fileName: undefined, url: '' })} placeholder="Paste article body here" /></label>
      <label>Or article URL<input value={state.source.url} onChange={(event) => state.setSource({ url: event.target.value, filePath: undefined, fileName: undefined, text: '' })} placeholder="https://…" /></label>
      <label className="consent"><input type="checkbox" checked={state.source.urlConsent} onChange={(event) => state.setSource({ urlConsent: event.target.checked })} /> I allow BloomAI&apos;s server to fetch this URL and extract article text. If it fails, I can paste the text instead.</label>
      <label>Or upload MD, TXT, DOCX, PDF<input type="file" accept=".md,.markdown,.txt,.docx,.pdf" onChange={(event) => void upload(event.target.files?.[0])} /></label>
      {state.source.fileName && <small>Selected file: {state.source.fileName}</small>}
    </section>

    <section className="article-card">
      <h3>Generation route</h3>
      <label><input type="radio" checked={state.executionMode === 'skill'} onChange={() => state.setExecution('skill', state.selectedSkillVersionId ?? state.eligibleSkills[0]?.skillVersionId)} /> Package Skill (preferred)</label>
      <label><input type="radio" checked={state.executionMode === 'fallback'} onChange={() => state.setExecution('fallback')} /> Current image model fallback</label>
      {state.executionMode === 'skill' && <select value={state.selectedSkillVersionId || ''} onChange={(event) => state.setExecution('skill', event.target.value)}><option value="">Select an eligible Skill</option>{state.eligibleSkills.map((skill) => <option key={skill.skillVersionId} value={skill.skillVersionId}>{skill.packageName} ({skill.version})</option>)}</select>}
      <label>Image count (1–12)<input type="number" min="1" max="12" value={state.config.imageCount} onChange={(event) => state.setConfig({ imageCount: Math.max(1, Math.min(12, Number(event.target.value) || 1)) })} /></label>
      <label>Model<select value={state.config.model} onChange={(event) => state.setConfig({ model: event.target.value })}><option value="">Use configured default</option>{imageModels.map((model) => <option key={model.id} value={model.modelId}>{model.label || model.modelId}</option>)}</select></label>
      <label>Aspect ratio<select value={state.config.aspectRatioId} onChange={(event) => state.setConfig({ aspectRatioId: event.target.value })}>{ASPECT_RATIOS.map((ratio) => <option key={ratio.id} value={ratio.id}>{ratio.label} — {ratio.hint}</option>)}</select></label>
      <label>Style<select value={state.config.styleId} onChange={(event) => state.setConfig({ styleId: event.target.value })}>{IMAGE_STYLES.map((style) => <option key={style.id} value={style.id}>{style.label}</option>)}</select></label>
      <div className="article-permissions"><strong>Permissions and budget</strong>{state.executionMode === 'skill' ? <><span>Requested: {selectedSkill?.requiredCapabilities.join(', ') || 'Select a Skill'}</span><span>Active image grant: {selectedSkill?.activeImageGrant ? selectedSkill.activeImageGrant.grantMode + '; ' + (selectedSkill.activeImageGrant.maxCalls ?? 'no') + ' call limit' : 'none — generation will remain protected by Runtime approval'}</span><span>Estimated image calls: {state.config.imageCount}</span></> : <><span>Route: existing Image Studio model</span><span>Estimated image calls: {state.config.imageCount}</span></>}</div>
      <button disabled={state.loading || (state.executionMode === 'skill' && !state.selectedSkillVersionId)} onClick={() => void state.createPlan()}>Create editable plan</button>
    </section>

    {state.error && <section className="article-error"><span>{state.error}</span>{state.source.url && <button onClick={() => state.setSource({ url: '', urlConsent: false, text: '' })}>Switch to pasted text</button>}</section>}

    {state.recoverableJobs.length > 0 && <section className="article-card article-recovery"><h3>Recoverable work</h3>{state.recoverableJobs.map((job) => <div className="article-recovery-row" key={job.id}><span>{job.source_label} — {job.status}</span><button onClick={() => state.openJob(job)}>Open</button>{job.status === 'interrupted' && <button onClick={() => void state.resumeJob(job.id)}>Resume</button>}</div>)}</section>}

    {state.scenes.length > 0 && <section className="article-card article-plan"><h3>Illustration plan — {state.scenes.length} images</h3>{state.scenes.map((scene, index) => <article className="article-scene" key={scene.id}><div className="article-scene-heading"><strong>{index + 1}. </strong><input aria-label="Scene title" value={scene.title} onChange={(event) => state.updateScene(scene.id, { title: event.target.value })} /><button onClick={() => state.moveScene(scene.id, -1)} disabled={index === 0}>↑</button><button onClick={() => state.moveScene(scene.id, 1)} disabled={index === state.scenes.length - 1}>↓</button><button onClick={() => state.removeScene(scene.id)} disabled={state.scenes.length === 1}>Delete</button></div><label>Excerpt<input value={scene.excerpt} onChange={(event) => state.updateScene(scene.id, { excerpt: event.target.value })} /></label><label>Prompt<textarea value={scene.prompt} onChange={(event) => state.updateScene(scene.id, { prompt: event.target.value })} /></label><small>{scene.status}{scene.error_message ? ' — ' + scene.error_message : ''}</small>{scene.status === 'failed' && <button onClick={() => void state.retryScene(scene.id)} disabled={!state.activeJob}>Retry scene</button>}</article>)}<div className="article-actions"><button onClick={() => state.addScene()} disabled={state.scenes.length >= 12}>Add scene</button><button disabled={state.loading || !state.scenes.length || state.activeJob?.status === 'running'} onClick={() => void state.confirm()}>Confirm and generate</button></div></section>}

    {state.activeJob && <section className="article-card article-results"><div className="article-results-heading"><h3>Run: {state.activeJob.status}</h3><div><button onClick={() => void state.refreshJob()}>Refresh progress</button><button onClick={() => void exportMarkdown()}>Export Markdown</button></div></div><p>{state.scenes.filter((scene) => scene.status === 'completed').length}/{state.scenes.length} scenes completed</p><div className="article-result-grid">{state.scenes.map((scene) => { const generation = scene.generation_id ? generatedById.get(scene.generation_id) : undefined; return <div className="article-result" key={scene.id}><strong>{scene.ordinal}. {scene.title}</strong>{generation ? <GenerationCard gen={generation} /> : <small>{scene.status}{scene.error_message ? ' — ' + scene.error_message : ''}</small>}</div> })}</div></section>}
  </main>
}
