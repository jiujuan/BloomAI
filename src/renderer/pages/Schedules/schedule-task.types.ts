import type { CreateScheduleTaskInput, ScheduleTaskDto, ScheduleTaskRunDto } from '@shared/schedules/contracts'

export type ScheduleTaskFormValues = CreateScheduleTaskInput
export type ScheduleTaskFormErrors = Partial<Record<keyof ScheduleTaskFormValues, string>>

export interface ScheduleCronTemplate {
  label: string
  cron: string
  description: string
}

export const SCHEDULE_CRON_TEMPLATES: readonly ScheduleCronTemplate[] = [
  { label: '每天上午 9:00', cron: '0 9 * * *', description: '每日简报、待办汇总' },
  { label: '工作日上午 9:00', cron: '0 9 * * 1-5', description: '仅周一至周五执行' },
  { label: '每周一上午 9:00', cron: '0 9 * * 1', description: '每周例行任务' },
  { label: '每月 1 日上午 9:00', cron: '0 9 1 * *', description: '月度回顾、报告' },
]

export function createScheduleTaskFormValues(task?: ScheduleTaskDto): ScheduleTaskFormValues {
  return {
    name: task?.name ?? '',
    cron: task?.cron ?? '0 9 * * *',
    timezone: task?.timezone ?? 'Asia/Shanghai',
    prompt: '',
  }
}

export function normalizeScheduleTaskForm(values: ScheduleTaskFormValues): ScheduleTaskFormValues {
  return {
    name: values.name.trim(),
    cron: values.cron.trim(),
    timezone: values.timezone.trim(),
    prompt: values.prompt.trim(),
  }
}

/** Client-side feedback only; server validation remains the source of truth for cron and IANA zones. */
export function validateScheduleTaskForm(values: ScheduleTaskFormValues, options: { requirePrompt?: boolean } = {}): ScheduleTaskFormErrors {
  const normalized = normalizeScheduleTaskForm(values)
  const errors: ScheduleTaskFormErrors = {}
  if (!normalized.name) errors.name = '请输入任务名称。'
  if (!normalized.cron) errors.cron = '请输入 Cron 表达式。'
  if (!normalized.timezone) errors.timezone = '请输入 IANA 时区，例如 Asia/Shanghai。'
  if ((options.requirePrompt ?? true) && !normalized.prompt) errors.prompt = '请输入任务提示词。'
  return errors
}

export function hasScheduleTaskFormErrors(errors: ScheduleTaskFormErrors): boolean {
  return Object.keys(errors).length > 0
}

export function formatScheduleTimestamp(value: number | null): string {
  if (value === null) return '尚未执行'
  return new Date(value).toLocaleString()
}

export function statusLabel(status: ScheduleTaskDto['status'] | ScheduleTaskRunDto['status']): string {
  const labels: Record<ScheduleTaskDto['status'] | ScheduleTaskRunDto['status'], string> = {
    active: '运行中',
    paused: '已暂停',
    succeeded: '成功',
    failed: '失败',
    skipped: '跳过',
    aborted: '中止',
    discarded: '已丢弃',
  }
  return labels[status]
}
