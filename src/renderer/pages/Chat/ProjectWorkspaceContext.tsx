import React from 'react'
import { AlertTriangle } from 'lucide-react'
import { useProjectStore, useSessionStore } from '@renderer/store'

export const PROJECT_WORKSPACE_UNAVAILABLE_MESSAGE = '项目工作目录不可用；已阻止发送依赖 Workspace 的任务。'

export function isProjectWorkspaceUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return message.includes('PROJECT_WORKSPACE_UNAVAILABLE') || message.includes('项目工作目录不可用')
}

export function canSendProjectWorkspaceTask(
  projectId: string | null | undefined,
  workspaceUnavailableProjectIds: Record<string, boolean>,
): boolean {
  return !projectId || !workspaceUnavailableProjectIds[projectId]
}

export function shouldRenderProjectWorkspaceContext(projectId: string | null | undefined): boolean {
  return Boolean(projectId)
}

export function ProjectWorkspaceContext() {
  const activeSessionId = useSessionStore((state) => state.activeSessionId)
  const session = useSessionStore((state) => state.sessions.find((item) => item.id === activeSessionId))
  const project = useProjectStore((state) => session?.project_id ? state.projects.find((item) => item.id === session.project_id) : undefined)
  const workspaceUnavailable = useProjectStore((state) => session?.project_id ? !!state.workspaceUnavailableProjectIds[session.project_id] : false)
  if (!shouldRenderProjectWorkspaceContext(session?.project_id)) return null
  if (!project) return <div className="project-workspace-warning" role="alert"><AlertTriangle size={14} />项目目录信息尚未加载；请等待项目列表加载后再执行文件或命令任务。</div>
  if (workspaceUnavailable || !project.root_path) return <div className="project-workspace-warning" role="alert"><AlertTriangle size={14} />{PROJECT_WORKSPACE_UNAVAILABLE_MESSAGE}</div>
  return null
}
