import type { ToolExecutor } from './types'
import { readTextFileLimited, resolveToolPath } from './utils/tool-resource'

export const docCsvTool: ToolExecutor<{ path: string; limit?: number }> = async (input, context) => {
  const filePath = await resolveToolPath(input.path, context, 'read')
  const limited = await readTextFileLimited(filePath, context)
  const content = limited.text
  const lines = content.split('\n').filter(l => l.trim())
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''))
  const limit = input.limit || 100
  const rows = lines.slice(1, limit + 1).map(l => l.split(',').map(v => v.trim().replace(/"/g, '')))
  const stats: any = {}
  headers.forEach((h, i) => {
    const vals = rows.map(r => r[i]).filter(v => v)
    const nums = vals.map(v => parseFloat(v)).filter(n => !isNaN(n))
    stats[h] = nums.length > 0 ? { count: nums.length, min: Math.min(...nums), max: Math.max(...nums), avg: nums.reduce((a,b)=>a+b,0)/nums.length } : { count: vals.length, unique: new Set(vals).size }
  })
  return { headers, rows: rows.slice(0, 20), totalRows: lines.length - 1, stats, truncated: limited.truncated }
}
