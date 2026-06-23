import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diff < 604_800_000) return d.toLocaleDateString([], { weekday: 'short' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function formatDate(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  const diff = now.getTime() - d.getTime()
  if (diff < 604_800_000) return d.toLocaleDateString([], { weekday: 'long' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

export function groupSessionsByDate(sessions: Array<{ id: string; updated_at: number; [k: string]: any }>) {
  const groups: Record<string, typeof sessions> = {}
  for (const s of sessions) {
    const label = formatDate(s.updated_at)
    if (!groups[label]) groups[label] = []
    groups[label].push(s)
  }
  return groups
}

export const PERSONA_COLORS: Record<string, string> = {
  developer: '#534AB7',
  writer: '#0F6E56',
  analyst: '#BA7517',
  translator: '#185FA5',
  coach: '#993C1D',
}

export const MODEL_LABELS: Record<string, string> = {
  'claude-3-5-sonnet-20241022': 'claude-3.5-sonnet',
  'claude-3-opus-20240229': 'claude-3-opus',
  'claude-3-haiku-20240307': 'claude-3-haiku',
  'gpt-4o': 'gpt-4o',
  'gpt-4o-mini': 'gpt-4o-mini',
}

export const AVAILABLE_MODELS = [
  { id: 'claude-3-5-sonnet-20241022', label: 'claude-3.5-sonnet', provider: 'Anthropic', badge: 'Recommended' },
  { id: 'claude-3-opus-20240229', label: 'claude-3-opus', provider: 'Anthropic', badge: 'Powerful' },
  { id: 'claude-3-haiku-20240307', label: 'claude-3-haiku', provider: 'Anthropic', badge: 'Fast' },
  { id: 'gpt-4o', label: 'gpt-4o', provider: 'OpenAI', badge: '' },
  { id: 'gpt-4o-mini', label: 'gpt-4o-mini', provider: 'OpenAI', badge: 'Cheap' },
]
