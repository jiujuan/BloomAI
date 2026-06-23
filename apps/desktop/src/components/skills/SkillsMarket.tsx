import React, { useEffect, useState } from 'react'
import { Search, Plus, Download, Check } from 'lucide-react'
import { useSkillsStore } from '../../stores/skills.store'
import { SkillEditor } from './SkillEditor'
import { cn } from '../../lib/utils'

const TYPE_BADGE: Record<string, string> = { 'js-function': 'JS', 'http-api': 'HTTP', 'prompt-template': 'Prompt' }
const TYPE_ICON: Record<string, string> = { 'js-function': '⚙️', 'http-api': '🌐', 'prompt-template': '💬' }

export function SkillsMarket() {
  const { installed, market, loadInstalled, loadMarket, installSkill, uninstallSkill } = useSkillsStore()
  const [query, setQuery] = useState('')
  const [showEditor, setShowEditor] = useState(false)

  useEffect(() => { loadInstalled(); loadMarket() }, [])

  const handleSearch = (q: string) => { setQuery(q); loadMarket(q) }
  const installedIds = new Set(installed.map(s => s.id))
  const marketOnly = market.filter(s => !installedIds.has(s.id) || !s.is_installed)

  return (
    <div className="skills-page">
      <div className="skills-topbar">
        <span className="skills-title">🧩 Skills</span>
        <div className="skills-search">
          <Search size={13} />
          <input value={query} onChange={e => handleSearch(e.target.value)} placeholder="Search skills…" />
        </div>
        <button className="skills-tbtn primary" onClick={() => setShowEditor(true)}><Plus size={13} /> Create Skill</button>
      </div>

      <div className="skills-body">
        <div className="skills-section">
          <div className="skills-section-head"><span className="skills-section-title">Installed ({installed.length})</span></div>
          <div className="skills-grid">
            {installed.map(skill => (
              <SkillCard key={skill.id} skill={skill} installed onUninstall={() => skill.author !== 'official' ? null : uninstallSkill(skill.id)} />
            ))}
          </div>
        </div>

        <div className="skills-section">
          <div className="skills-section-head"><span className="skills-section-title">Market Recommendations</span></div>
          <div className="skills-grid">
            {marketOnly.map(skill => <SkillCard key={skill.id} skill={skill} onInstall={() => installSkill(skill.id)} />)}
            {marketOnly.length === 0 && <div className="skills-empty">All skills installed, or no results found</div>}
          </div>
        </div>
      </div>

      {showEditor && <SkillEditor onClose={() => setShowEditor(false)} />}
    </div>
  )
}

function SkillCard({ skill, installed, onInstall, onUninstall }: { skill: any; installed?: boolean; onInstall?: () => void; onUninstall?: () => void }) {
  return (
    <div className={cn('skill-card', installed && 'installed')}>
      <div className="skill-card-top">
        <div className="skill-card-icon">{TYPE_ICON[skill.type]}</div>
        <div className="skill-card-info">
          <div className="skill-card-name">{skill.name}</div>
          <div className="skill-card-author">{skill.author === 'official' ? 'Official' : skill.author === 'community' ? 'Community' : 'Custom'}</div>
        </div>
      </div>
      <div className="skill-card-desc">{skill.description}</div>
      <div className="skill-card-foot">
        <span className="skill-type-badge">{TYPE_BADGE[skill.type]}</span>
        {installed ? (
          <span className="skill-installed-badge"><Check size={11} /> Installed</span>
        ) : (
          <>
            <span className="skill-install-count"><Download size={10} /> {skill.install_count}</span>
            <button className="skill-install-btn" onClick={onInstall}><Plus size={11} /> Install</button>
          </>
        )}
      </div>
    </div>
  )
}
