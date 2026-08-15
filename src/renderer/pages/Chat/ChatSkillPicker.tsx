import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Sparkles, X } from 'lucide-react'
import type { ChatSkillReferenceDto } from '@renderer/api'
import { cn } from '@renderer/utils'

const SKILLS_PER_PAGE = 20

export function skillDisplayName(packageName: string): string {
  return packageName.replace(/\s*·\s*v\d+(?:\.\d+)*(?:[-+][\w.-]+)?\s*$/i, '').trim()
}

export function filterChatSkills(skills: ChatSkillReferenceDto[], query: string): ChatSkillReferenceDto[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return skills
  return skills.filter((skill) => {
    const name = skillDisplayName(skill.packageName).toLocaleLowerCase()
    return name.includes(normalizedQuery) || skill.description.toLocaleLowerCase().includes(normalizedQuery)
  })
}

export function paginateChatSkills(skills: ChatSkillReferenceDto[], page: number, pageSize = SKILLS_PER_PAGE): ChatSkillReferenceDto[] {
  const start = (page - 1) * pageSize
  return skills.slice(start, start + pageSize)
}

export type ChatSkillPickerProps = {
  skills: ChatSkillReferenceDto[]
  selectedSkillVersionId: string
  onSelect: (skillVersionId: string) => void
  onRemove: () => void
  disabled?: boolean
}

export function ChatSkillPicker({
  skills,
  selectedSkillVersionId,
  onSelect,
  onRemove,
  disabled = false,
}: ChatSkillPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const selectedSkill = skills.find((skill) => skill.skillVersionId === selectedSkillVersionId)
  const filteredSkills = useMemo(() => filterChatSkills(skills, query), [skills, query])
  const totalPages = Math.max(1, Math.ceil(filteredSkills.length / SKILLS_PER_PAGE))
  const visibleSkills = paginateChatSkills(filteredSkills, Math.min(page, totalPages))

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => searchRef.current?.focus())
  }, [open])

  const openPicker = () => {
    if (disabled) return
    setOpen((current) => !current)
  }

  const selectSkill = (skillVersionId: string) => {
    onSelect(skillVersionId)
    setOpen(false)
  }

  return (
    <div className="chat-skill-picker" ref={rootRef}>
      {selectedSkill && (
        <span className="selected-chat-skill" data-testid="selected-chat-skill">
          <strong>{skillDisplayName(selectedSkill.packageName)}</strong>
          <button
            type="button"
            className="selected-chat-skill-remove"
            aria-label={`移除技能 ${skillDisplayName(selectedSkill.packageName)}`}
            disabled={disabled}
            onClick={onRemove}
          >
            <X size={13} aria-hidden="true" />
          </button>
        </span>
      )}
      <button
        type="button"
        className={cn('skill-tab', open && 'active')}
        aria-pressed={open}
        aria-controls="chat-skill-popover"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={openPicker}
      >
        技能
      </button>
      {open && (
        <section id="chat-skill-popover" className="chat-skill-popover" role="dialog" aria-label="选择技能">
          <label className="chat-skill-search">
            <Search size={15} aria-hidden="true" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setPage(1)
              }}
              placeholder="搜索技能"
              aria-label="搜索技能"
            />
          </label>
          <div className="chat-skill-card-list">
            {visibleSkills.length > 0 ? visibleSkills.map((skill) => (
              <button
                key={skill.skillVersionId}
                type="button"
                className="chat-skill-card"
                onClick={() => selectSkill(skill.skillVersionId)}
              >
                <span className="chat-skill-card-icon" aria-hidden="true"><Sparkles size={13} /></span>
                <span className="chat-skill-card-copy">
                  <strong>{skillDisplayName(skill.packageName)}</strong>
                  <span>{skill.description || '暂无技能说明'}</span>
                </span>
              </button>
            )) : (
              <div className="chat-skill-empty">未找到匹配的技能</div>
            )}
          </div>
          {totalPages > 1 && (
            <nav className="chat-skill-pagination" aria-label="技能分页">
              <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>上一页</button>
              <button type="button" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>下一页</button>
              <span>共 {totalPages} 页</span>
            </nav>
          )}
        </section>
      )}
    </div>
  )
}