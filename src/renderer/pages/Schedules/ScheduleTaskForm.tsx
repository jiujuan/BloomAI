import React, { useState } from 'react'
import type { CreateScheduleTaskInput, ScheduleTaskDto, UpdateScheduleTaskInput } from '@shared/schedules/contracts'
import {
  createScheduleTaskFormValues,
  hasScheduleTaskFormErrors,
  normalizeScheduleTaskForm,
  SCHEDULE_CRON_TEMPLATES,
  type ScheduleTaskFormErrors,
  type ScheduleTaskFormValues,
  validateScheduleTaskForm,
} from './schedule-task.types'

interface ScheduleTaskFormProps {
  task?: ScheduleTaskDto
  saving: boolean
  onSubmit: (input: CreateScheduleTaskInput | UpdateScheduleTaskInput) => void | Promise<void>
  onCancel: () => void
}

export function ScheduleTaskForm({ task, saving, onSubmit, onCancel }: ScheduleTaskFormProps) {
  const [values, setValues] = useState<ScheduleTaskFormValues>(() => createScheduleTaskFormValues(task))
  const [errors, setErrors] = useState<ScheduleTaskFormErrors>({})

  const update = <K extends keyof ScheduleTaskFormValues>(key: K, value: ScheduleTaskFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nextErrors = validateScheduleTaskForm(values, { requirePrompt: !task })
    setErrors(nextErrors)
    if (!hasScheduleTaskFormErrors(nextErrors)) {
      const normalized = normalizeScheduleTaskForm(values)
      const input = task && !normalized.prompt
        ? { name: normalized.name, cron: normalized.cron, timezone: normalized.timezone }
        : normalized
      void onSubmit(input)
    }
  }

  return (
    <form className="schedule-task-form" onSubmit={submit} noValidate>
      <div className="schedule-form-heading">
        <div>
          <h2>{task ? '编辑定时任务' : '新建定时任务'}</h2>
          <p>每次执行都会创建独立任务会话，不会写入聊天记录。</p>
        </div>
      </div>

      <label>
        <span>任务名称</span>
        <input
          aria-label="任务名称"
          value={values.name}
          maxLength={120}
          onChange={(event) => update('name', event.target.value)}
          aria-invalid={Boolean(errors.name)}
          placeholder="例如：每日项目简报"
        />
        {errors.name && <small className="schedule-field-error">{errors.name}</small>}
      </label>

      <fieldset className="schedule-cron-templates">
        <legend>常用调度模板</legend>
        <div>
          {SCHEDULE_CRON_TEMPLATES.map((template) => (
            <button key={template.cron} type="button" onClick={() => update('cron', template.cron)} title={template.description}>
              {template.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="schedule-form-grid">
        <label>
          <span>高级 Cron 表达式</span>
          <input
            aria-label="高级 Cron 表达式"
            value={values.cron}
            maxLength={256}
            onChange={(event) => update('cron', event.target.value)}
            aria-invalid={Boolean(errors.cron)}
            placeholder="0 9 * * *"
          />
          {errors.cron && <small className="schedule-field-error">{errors.cron}</small>}
        </label>
        <label>
          <span>IANA 时区</span>
          <input
            aria-label="IANA 时区"
            value={values.timezone}
            maxLength={100}
            onChange={(event) => update('timezone', event.target.value)}
            aria-invalid={Boolean(errors.timezone)}
            placeholder="Asia/Shanghai"
          />
          {errors.timezone && <small className="schedule-field-error">{errors.timezone}</small>}
        </label>
      </div>

      <label>
        <span>任务提示词{task ? '（留空则保留原提示词）' : ''}</span>
        <textarea
          aria-label="任务提示词"
          value={values.prompt}
          maxLength={12_000}
          onChange={(event) => update('prompt', event.target.value)}
          aria-invalid={Boolean(errors.prompt)}
          placeholder={task ? "如需修改提示词，请输入新内容。" : "说明这个任务每次执行时需要完成什么。"}
        />
        {errors.prompt && <small className="schedule-field-error">{errors.prompt}</small>}
      </label>

      <div className="schedule-form-actions">
        <button className="btn-secondary" type="button" onClick={onCancel} disabled={saving}>取消</button>
        <button className="btn-primary" type="submit" disabled={saving}>{saving ? '保存中…' : '保存任务'}</button>
      </div>
    </form>
  )
}
