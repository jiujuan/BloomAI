import React, { useEffect } from 'react'
import { platform } from '@renderer/api'
import { DeepResearchLauncher } from './DeepResearchLauncher'
import { DeepResearchRunView } from './DeepResearchRunView'
import { useDeepResearchStore } from './deep-research.store'
import type { ResearchRunDto } from '@shared/deepresearch/contracts'

export interface DeepResearchWorkbenchProps {
  sessionId?: string
  onRunStarted?: (run: ResearchRunDto) => void
}

export function DeepResearchWorkbench({ sessionId, onRunStarted }: DeepResearchWorkbenchProps) {
  const state = useDeepResearchStore()

  useEffect(() => {
    if (sessionId && state.draft.sessionId !== sessionId) state.setDraft({ sessionId })
  }, [sessionId, state])

  const exportReport = () => {
    if (!state.run?.reportArtifactId || typeof document === 'undefined') return
    const anchor = document.createElement('a')
    anchor.href = platform.deepResearch.artifactUrl(state.run.id, state.run.reportArtifactId)
    anchor.download = 'deep-research-report.md'
    anchor.click()
  }

  const startResearch = async () => {
    await state.start()
    const run = useDeepResearchStore.getState().run
    if (run) onRunStarted?.(run)
  }

  return <main className="deep-research-workbench">
    {state.run ? <DeepResearchRunView
      run={state.run}
      questions={state.questions}
      sources={state.sources}
      snapshotsById={state.snapshotsById}
      report={state.report}
      artifacts={state.artifacts}
      evidenceById={state.evidenceById}
      events={state.events}
      selectedView={state.selectedView}
      selectedEvidenceId={state.selectedEvidenceId}
      loading={state.loading}
      error={state.error}
      onSelectedViewChange={state.setSelectedView}
      onSelectEvidence={state.selectEvidence}
      onCancel={() => { void state.cancel() }}
      onResume={() => { void state.resume() }}
      onExport={exportReport}
      onAnswerClarification={(clarificationId, answer) => { void state.answerClarification(clarificationId, answer) }}
    /> : <DeepResearchLauncher draft={state.draft} loading={state.loading} error={state.error} onDraftChange={state.setDraft} onStart={() => { void startResearch() }} />}
  </main>
}
