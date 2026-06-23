import React, { useState } from 'react'
import { Shield, ShieldAlert, ShieldX, Check, AlertTriangle } from 'lucide-react'
import { cn } from '../../lib/utils'

interface PermissionDialogProps {
  toolId: string
  level: 'fs' | 'network' | 'write' | 'shell'
  onResolve: (granted: boolean, scope: 'session' | 'permanent') => void
}

const LEVEL_CONFIG = {
  fs: { icon: Shield, color: 'ok', label: '低风险 · 只读', desc: '读取本地文件内容，不会修改任何文件。',
        perms: ['读取指定路径文件内容', '访问范围仅限用户家目录', '不可删除或写入文件'] },
  network: { icon: ShieldAlert, color: 'warn', label: '中风险 · 网络访问', desc: '将访问外部网络资源获取内容。',
        perms: ['仅访问明确指定的 URL', '不会自动跳转其他域名', '内容仅用于当前对话'] },
  write: { icon: ShieldAlert, color: 'warn', label: '中风险 · 写入', desc: '将修改或创建本地文件。',
        perms: ['可创建或修改指定文件', '不会删除文件系统中其他内容', '操作前会显示具体路径'] },
  shell: { icon: ShieldX, color: 'danger', label: '高风险 · 完整 Shell', desc: '获得完整命令执行能力，包括任意文件操作和系统调用。',
        perms: ['可执行任意 Shell 命令', '可读写删除任意文件', '可发起任意网络请求'] },
}

export function PermissionDialog({ toolId, level, onResolve }: PermissionDialogProps) {
  const [scope, setScope] = useState<'session' | 'permanent'>('session')
  const config = LEVEL_CONFIG[level]
  const Icon = config.icon

  return (
    <div className="perm-overlay">
      <div className="perm-dialog">
        <div className="perm-dlg-top">
          <div className="perm-icon-row">
            <div className={cn('perm-dicon', config.color)}><Icon size={20} /></div>
            <div>
              <div className="perm-dlg-name">{toolId}</div>
              <div className="perm-dlg-sub">请求权限</div>
            </div>
          </div>
          <span className={cn('perm-risk-badge', config.color)}>
            {config.color === 'danger' && <AlertTriangle size={12} />}
            {config.label}
          </span>
        </div>

        <div className="perm-dlg-body">
          <div className="perm-desc">{config.desc}</div>
          {config.color === 'danger' && (
            <div className="perm-warn-box">
              <AlertTriangle size={14} />
              <span>此操作不可自动撤销，请确认你信任该工具的使用场景。</span>
            </div>
          )}
          <div className="perm-list">
            {config.perms.map(p => (
              <div key={p} className="perm-item-row">
                <span className={cn('perm-dot', config.color)} />
                {p}
              </div>
            ))}
          </div>
          <div className="perm-scope-row">
            <button className={cn('perm-scope-opt', scope === 'session' && 'on')} onClick={() => setScope('session')}>
              <div className="perm-scope-label">仅本次</div>
              <div className="perm-scope-desc">本会话有效</div>
            </button>
            <button className={cn('perm-scope-opt', scope === 'permanent' && 'on')} onClick={() => setScope('permanent')}>
              <div className="perm-scope-label">永久允许</div>
              <div className="perm-scope-desc">记住选择</div>
            </button>
          </div>
        </div>

        <div className="perm-dlg-foot">
          <button className="perm-btn" onClick={() => onResolve(false, scope)}>拒绝</button>
          <div style={{ flex: 1 }} />
          <button className={cn('perm-btn', config.color)} onClick={() => onResolve(true, scope)}>
            {config.color === 'danger' ? <><AlertTriangle size={13} /> 了解风险，允许</> : <><Check size={13} /> 允许</>}
          </button>
        </div>
      </div>
    </div>
  )
}
