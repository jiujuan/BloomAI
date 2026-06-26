import fs from 'node:fs'
import path from 'node:path'

export type ConfigValue = {
  value: string
  source: 'process.env' | '.env' | 'default'
  key: string
  filePath?: string
}

export function readConfigValue(key: string, fallback = ''): ConfigValue {
  const envPath = getDefaultEnvPath()
  const processValue = process.env[key]?.trim()
  if (processValue) return { value: processValue, source: 'process.env', key }

  const fileValue = readDotEnvValue(envPath, key)
  if (fileValue) return { value: fileValue, source: '.env', key, filePath: envPath }

  return { value: fallback, source: 'default', key, filePath: envPath }
}

export function setConfigValue(key: string, value: string, filePath = getDefaultEnvPath()): void {
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
  const next = writeDotEnvValue(current, key, value)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, next, 'utf8')
  process.env[key] = value
}

function getDefaultEnvPath(): string {
  return path.join(process.cwd(), '.env')
}

function readDotEnvValue(filePath: string, key: string): string {
  if (!fs.existsSync(filePath)) return ''
  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = stripBom(lines[i]).trim()
    if (!rawLine || rawLine.startsWith('#')) continue
    const normalized = rawLine.startsWith('export ') ? rawLine.slice(7).trim() : rawLine
    const separator = normalized.indexOf('=')
    if (separator < 0) continue
    const currentKey = normalized.slice(0, separator).trim()
    if (currentKey !== key) continue
    return unquote(stripInlineComment(normalized.slice(separator + 1).trim()))
  }
  return ''
}

function writeDotEnvValue(content: string, key: string, value: string): string {
  const lines = content ? content.split(/\r?\n/) : []
  let replaced = false
  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = stripBom(lines[i]).trim()
    if (!rawLine || rawLine.startsWith('#')) continue
    const normalized = rawLine.startsWith('export ') ? rawLine.slice(7).trim() : rawLine
    const separator = normalized.indexOf('=')
    if (separator < 0) continue
    const currentKey = normalized.slice(0, separator).trim()
    if (currentKey !== key) continue
    lines[i] = key + '=' + serializeScalar(value)
    replaced = true
    break
  }
  if (!replaced) lines.push(key + '=' + serializeScalar(value))
  return lines.filter(Boolean).join('\n') + '\n'
}

function serializeScalar(value: string): string {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value
  return JSON.stringify(value)
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xFEFF ? value.slice(1) : value
}

function stripInlineComment(value: string): string {
  const first = value.charCodeAt(0)
  if (first === 34 || first === 39) return value
  const index = value.indexOf(' #')
  return index >= 0 ? value.slice(0, index).trim() : value
}
function unquote(value: string): string {
  const first = value.charCodeAt(0)
  const last = value.charCodeAt(value.length - 1)
  if (first === 34 && first === last) return value.slice(1, -1)
  if (first === 39 && first === last) return value.slice(1, -1)
  return value
}