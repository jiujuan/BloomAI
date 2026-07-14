import React, { useEffect, useMemo } from 'react'
import { platform } from '@renderer/api'
import { useImageStore, useLlmStore } from '@renderer/store'
import { ASPECT_RATIOS, IMAGE_STYLES } from '@shared/image-gen'
import { GenerationCard } from './parts/GenerationCard'
import { useArticleIllustrationStore } from './article-illustration.store'

export const articleSourceTabs = [
  { id: 'text' as const, label: '文章文本' },
  { id: 'file' as const, label: '上传文件' },
]

export const articleExecutionTabs = [
  { id: 'skill' as const, label: 'Skill 优先' },
  { id: 'fallback' as const, label: '现有模型兜底' },
]

const articleStatusLabels: Record<string, string> = {
  planned: '待生成',
  running: '生成中',
  completed: '已完成',
  failed: '失败',
  interrupted: '已中断',
}

function articleStatusLabel(status: string) {
  return articleStatusLabels[status] ?? status
}

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
      state.setSourceMode('file')
      state.setSource({ filePath: (attachment as any).path, fileName: attachment.name, text: '', url: '' })
    } catch (error) {
      state.setSource({ fileName: error instanceof Error ? error.message : '文件上传失败' })
    }
  }

  const selectExecutionMode = (mode: 'skill' | 'fallback') => {
    if (mode === 'skill') {
      state.setExecution('skill', state.selectedSkillVersionId ?? state.eligibleSkills[0]?.skillVersionId)
      return
    }
    state.setExecution('fallback')
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

  return (
    <main className="article-illustration" aria-live="polite">
      <section className="article-card">
        <h2>文章配图</h2>
        <p>选择文章来源，编辑配图方案后确认生成。</p>
        <div className="article-tabs" role="tablist" aria-label="文章来源">
          {articleSourceTabs.map((tab) => (
            <button
              key={tab.id}
              id={`article-source-tab-${tab.id}`}
              className="article-tab"
              role="tab"
              aria-selected={state.sourceMode === tab.id}
              aria-controls={`article-source-panel-${tab.id}`}
              onClick={() => state.setSourceMode(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {state.sourceMode === 'text' ? (
          <div id="article-source-panel-text" className="article-panel" role="tabpanel" aria-labelledby="article-source-tab-text">
            <label>文章正文<textarea value={state.source.text} onChange={(event) => { state.setSourceMode('text'); state.setSource({ text: event.target.value, filePath: undefined, fileName: undefined, url: '' }) }} placeholder="请粘贴文章正文" /></label>
          </div>
        ) : (
          <div id="article-source-panel-file" className="article-panel" role="tabpanel" aria-labelledby="article-source-tab-file">
            <label>上传 MD、TXT、DOCX 或 PDF 文件<input type="file" accept=".md,.markdown,.txt,.docx,.pdf" onChange={(event) => void upload(event.target.files?.[0])} /></label>
            {state.source.fileName && <small>已选择文件：{state.source.fileName}</small>}
          </div>
        )}
      </section>

      <section className="article-card">
        <h3>生成方式</h3>
        <div className="article-tabs" role="tablist" aria-label="生成方式">
          {articleExecutionTabs.map((tab) => (
            <button
              key={tab.id}
              id={`article-execution-tab-${tab.id}`}
              className="article-tab"
              role="tab"
              aria-selected={state.executionMode === tab.id}
              aria-controls={`article-execution-panel-${tab.id}`}
              onClick={() => selectExecutionMode(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div id={`article-execution-panel-${state.executionMode}`} className="article-panel" role="tabpanel" aria-labelledby={`article-execution-tab-${state.executionMode}`}>
          {state.executionMode === 'skill' && <label>可用 Skill<select value={state.selectedSkillVersionId || ''} onChange={(event) => state.setExecution('skill', event.target.value)}><option value="">请选择可用 Skill</option>{state.eligibleSkills.map((skill) => <option key={skill.skillVersionId} value={skill.skillVersionId}>{skill.packageName} ({skill.version})</option>)}</select></label>}
          <label>图片数量（1–12）<input type="number" min="1" max="12" value={state.config.imageCount} onChange={(event) => state.setConfig({ imageCount: Math.max(1, Math.min(12, Number(event.target.value) || 1)) })} /></label>
          <label>模型<select value={state.config.model} onChange={(event) => state.setConfig({ model: event.target.value })}><option value="">使用已配置的默认模型</option>{imageModels.map((model) => <option key={model.id} value={model.modelId}>{model.label || model.modelId}</option>)}</select></label>
          <label>图片比例<select value={state.config.aspectRatioId} onChange={(event) => state.setConfig({ aspectRatioId: event.target.value })}>{ASPECT_RATIOS.map((ratio) => <option key={ratio.id} value={ratio.id}>{ratio.label} — {ratio.hint}</option>)}</select></label>
          <label>图片风格<select value={state.config.styleId} onChange={(event) => state.setConfig({ styleId: event.target.value })}>{IMAGE_STYLES.map((style) => <option key={style.id} value={style.id}>{style.label}</option>)}</select></label>
          <div className="article-permissions"><strong>权限与预算</strong>{state.executionMode === 'skill' ? <><span>所需能力：{selectedSkill?.requiredCapabilities.join('、') || '请选择 Skill'}</span><span>当前图片授权：{selectedSkill?.activeImageGrant ? `${selectedSkill.activeImageGrant.grantMode}；${selectedSkill.activeImageGrant.maxCalls ?? '不限'} 次调用` : '无 — 生成仍受运行时审批保护'}</span><span>预计图片调用次数：{state.config.imageCount}</span></> : <><span>生成路由：现有 AI 画图模型</span><span>预计图片调用次数：{state.config.imageCount}</span></>}</div>
          <button disabled={state.loading || (state.executionMode === 'skill' && !state.selectedSkillVersionId)} onClick={() => void state.createPlan()}>创建可编辑方案</button>
        </div>
      </section>

      {state.error && <section className="article-error"><span>{state.error}</span></section>}

      {state.recoverableJobs.length > 0 && <section className="article-card article-recovery"><h3>可恢复任务</h3>{state.recoverableJobs.map((job) => <div className="article-recovery-row" key={job.id}><span>{job.source_label} — {articleStatusLabel(job.status)}</span><button onClick={() => state.openJob(job)}>打开</button>{job.status === 'interrupted' && <button onClick={() => void state.resumeJob(job.id)}>恢复</button>}</div>)}</section>}

      {state.scenes.length > 0 && <section className="article-card article-plan"><h3>配图方案 — {state.scenes.length} 张图片</h3>{state.scenes.map((scene, index) => <article className="article-scene" key={scene.id}><div className="article-scene-heading"><strong>{index + 1}. </strong><input aria-label="场景标题" value={scene.title} onChange={(event) => state.updateScene(scene.id, { title: event.target.value })} /><button onClick={() => state.moveScene(scene.id, -1)} disabled={index === 0}>↑</button><button onClick={() => state.moveScene(scene.id, 1)} disabled={index === state.scenes.length - 1}>↓</button><button onClick={() => state.removeScene(scene.id)} disabled={state.scenes.length === 1}>删除</button></div><label>文章片段<input value={scene.excerpt} onChange={(event) => state.updateScene(scene.id, { excerpt: event.target.value })} /></label><label>图片提示词<textarea value={scene.prompt} onChange={(event) => state.updateScene(scene.id, { prompt: event.target.value })} /></label><small>{articleStatusLabel(scene.status)}{scene.error_message ? ` — ${scene.error_message}` : ''}</small>{scene.status === 'failed' && <button onClick={() => void state.retryScene(scene.id)} disabled={!state.activeJob}>重试此场景</button>}</article>)}<div className="article-actions"><button onClick={() => state.addScene()} disabled={state.scenes.length >= 12}>添加场景</button><button disabled={state.loading || !state.scenes.length || state.activeJob?.status === 'running'} onClick={() => void state.confirm()}>确认并生成</button></div></section>}

      {state.activeJob && <section className="article-card article-results"><div className="article-results-heading"><h3>任务状态：{articleStatusLabel(state.activeJob.status)}</h3><div><button onClick={() => void state.refreshJob()}>刷新进度</button><button onClick={() => void exportMarkdown()}>导出 Markdown</button></div></div><p>已完成 {state.scenes.filter((scene) => scene.status === 'completed').length}/{state.scenes.length} 个场景</p><div className="article-result-grid">{state.scenes.map((scene) => { const generation = scene.generation_id ? generatedById.get(scene.generation_id) : undefined; return <div className="article-result" key={scene.id}><strong>{scene.ordinal}. {scene.title}</strong>{generation ? <GenerationCard gen={generation} /> : <small>{articleStatusLabel(scene.status)}{scene.error_message ? ` — ${scene.error_message}` : ''}</small>}</div> })}</div></section>}
    </main>
  )
}
