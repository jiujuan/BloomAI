import { toolRepo } from '../db/repositories/tool.repo'
import { db } from '../db/client'
import { generateImage } from '../llm'
import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as path from 'path'
import * as vm from 'vm'
import os from 'os'

const execFileAsync = promisify(execFile)
const ALLOWED_BASH = new Set(['ls','cat','echo','grep','find','pwd','wc','head','tail','diff','sort','uniq','tr','cp','mv','mkdir','rm','chmod'])

export async function executeTool(toolId: string, input: object, sessionId?: string): Promise<object> {
  const tool = toolRepo.get(toolId)
  if (!tool) throw new Error(`Tool not found: ${toolId}`)
  if (!tool.is_enabled) throw new Error(`Tool ${toolId} is disabled`)

  const run = toolRepo.startRun(toolId, sessionId || null, input)
  try {
    const result = await Promise.race([
      runTool(toolId, input),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Tool timeout after 15000ms`)), 15000))
    ])
    toolRepo.completeRun(run.id, result as object)
    return result as object
  } catch (err: any) {
    toolRepo.failRun(run.id, err.message)
    throw err
  }
}

async function runTool(toolId: string, input: any): Promise<object> {
  switch (toolId) {
    case 'web_search': return webSearch(input)
    case 'web_fetch': return webFetch(input)
    case 'web_screenshot': return { note: 'Screenshot requires Playwright — install separately' }
    case 'web_extract': return webExtract(input)
    case 'fs_read': return fsRead(input)
    case 'fs_write': return fsWrite(input)
    case 'fs_edit': return fsEdit(input)
    case 'fs_grep': return fsGrep(input)
    case 'fs_glob': return fsGlob(input)
    case 'bash': return bashRun(input)
    case 'doc_markdown': return docMarkdown(input)
    case 'doc_pdf': return docPdf(input)
    case 'doc_txt': return docTxt(input)
    case 'doc_csv': return docCsv(input)
    case 'doc_docx': return { note: 'DOCX parsing requires mammoth — install separately' }
    case 'vision': return visionAnalyze(input)
    case 'ocr': return { note: 'OCR requires Tesseract — install separately' }
    case 'image_gen': return imageGen(input)
    case 'image_edit': return { note: 'Image editing requires sharp — install separately' }
    case 'node_runner': return nodeRunner(input)
    case 'python_runner': return pythonRunner(input)
    case 'shell': return shellRun(input)
    default: throw new Error(`No executor for tool: ${toolId}`)
  }
}

async function webSearch(input: { query: string; limit?: number }) {
  const { query, limit = 8 } = input
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    const data = await res.json() as any
    const results: any[] = []
    if (data.RelatedTopics) {
      for (const topic of data.RelatedTopics.slice(0, limit)) {
        if (topic.Text && topic.FirstURL) results.push({ title: topic.Text.split(' - ')[0] || topic.Text, url: topic.FirstURL, snippet: topic.Text })
      }
    }
    if (data.Abstract && data.AbstractURL) results.unshift({ title: data.Heading || query, url: data.AbstractURL, snippet: data.Abstract })
    return { results: results.slice(0, limit), query, total: results.length }
  } catch (err: any) {
    return { results: [], query, error: err.message }
  }
}

async function webFetch(input: { url: string; mode?: string }) {
  const { url, mode = 'text' } = input
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BloomAI/0.2)' }, signal: AbortSignal.timeout(10000) })
  const html = await res.text()
  const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 8000)
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
  return { title: titleMatch ? titleMatch[1].trim() : url, content: mode === 'html' ? html.slice(0, 8000) : text, url }
}

async function webExtract(input: { url: string }) {
  const page = await webFetch({ url: input.url, mode: 'html' }) as any
  const html = page.content || ''
  const headings: string[] = []
  for (const h of (html.match(/<h[1-3][^>]*>([^<]+)<\/h[1-3]>/gi) || []).slice(0, 10)) {
    const text = h.replace(/<[^>]+>/g, '').trim(); if (text) headings.push(text)
  }
  const links: any[] = []
  for (const a of (html.match(/<a[^>]+href="([^"]+)"[^>]*>([^<]*)<\/a>/gi) || []).slice(0, 20)) {
    const m = a.match(/<a[^>]+href="([^"]+)"[^>]*>([^<]*)<\/a>/i)
    if (m) links.push({ url: m[1], text: m[2].trim() })
  }
  return { headings, links, title: page.title }
}

function resolveSafePath(p: string): string {
  const expanded = p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p
  return path.resolve(expanded)
}

async function fsRead(input: { path: string; offset?: number; limit?: number }) {
  const filePath = resolveSafePath(input.path)
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const offset = input.offset || 0; const limit = input.limit || lines.length
  return { content: lines.slice(offset, offset + limit).join('\n'), totalLines: lines.length, path: filePath }
}

async function fsWrite(input: { path: string; content: string; mode?: string }) {
  const filePath = resolveSafePath(input.path)
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  if (input.mode === 'append') fs.appendFileSync(filePath, input.content, 'utf-8')
  else fs.writeFileSync(filePath, input.content, 'utf-8')
  return { bytesWritten: Buffer.byteLength(input.content), path: filePath }
}

async function fsEdit(input: { path: string; oldText: string; newText: string }) {
  const filePath = resolveSafePath(input.path)
  const content = fs.readFileSync(filePath, 'utf-8')
  const count = (content.match(new RegExp(input.oldText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
  if (count !== 1) throw new Error(`oldText must appear exactly once; found ${count}`)
  fs.writeFileSync(filePath, content.replace(input.oldText, input.newText), 'utf-8')
  return { success: true, linesChanged: input.newText.split('\n').length }
}

async function fsGrep(input: { pattern: string; path: string; recursive?: boolean }) {
  const filePath = resolveSafePath(input.path)
  const regex = new RegExp(input.pattern, 'g')
  const matches: any[] = []
  const searchFile = (fp: string) => {
    const lines = fs.readFileSync(fp, 'utf-8').split('\n')
    lines.forEach((line, i) => { if (regex.test(line)) matches.push({ file: fp, line: i + 1, text: line.trim() }); regex.lastIndex = 0 })
  }
  if (fs.statSync(filePath).isDirectory() && input.recursive) {
    const walk = (dir: string) => { for (const f of fs.readdirSync(dir)) { const fp = path.join(dir, f); if (fs.statSync(fp).isDirectory()) walk(fp); else { try { searchFile(fp) } catch {} } } }
    walk(filePath)
  } else searchFile(filePath)
  return { matches: matches.slice(0, 100), total: matches.length }
}

async function fsGlob(input: { pattern: string; cwd?: string }) {
  const cwd = input.cwd ? resolveSafePath(input.cwd) : os.homedir()
  const files: any[] = []
  const matchGlob = (dir: string, depth = 0) => {
    if (depth > 5) return
    try {
      for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f); const stat = fs.statSync(fp)
        if (!f.startsWith('.')) {
          if (stat.isDirectory()) matchGlob(fp, depth + 1)
          else if (f.includes(input.pattern.replace('**/', '').replace('*', ''))) files.push({ path: fp, relativePath: path.relative(cwd, fp), size: stat.size, mtime: stat.mtimeMs })
        }
      }
    } catch {}
  }
  matchGlob(cwd)
  return { files: files.slice(0, 100), total: files.length, cwd }
}

async function bashRun(input: { command: string; cwd?: string }) {
  const [cmd, ...args] = input.command.trim().split(/\s+/)
  if (!ALLOWED_BASH.has(cmd)) throw new Error(`Command not allowed: ${cmd}`)
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { cwd: input.cwd ? resolveSafePath(input.cwd) : os.homedir(), timeout: 8000, maxBuffer: 512 * 1024 })
    return { stdout, stderr, exitCode: 0 }
  } catch (err: any) { return { stdout: '', stderr: err.message, exitCode: err.code || 1 } }
}

async function docMarkdown(input: { path: string }) {
  const content = fs.readFileSync(resolveSafePath(input.path), 'utf-8')
  const headings: string[] = []
  for (const line of content.split('\n')) if (line.startsWith('#')) headings.push(line.replace(/^#+\s*/, '').trim())
  const codeBlocks = (content.match(/```[\s\S]*?```/g) || []).map(c => c.slice(0, 200))
  const links = content.match(/\[([^\]]+)\]\(([^)]+)\)/g) || []
  return { text: content, headings: headings.slice(0, 20), codeBlocks: codeBlocks.slice(0, 10), links: links.slice(0, 20) }
}

async function docPdf(input: { path: string }) {
  const filePath = resolveSafePath(input.path)
  const stat = fs.statSync(filePath)
  return { text: `[PDF file: ${path.basename(filePath)}, size: ${(stat.size/1024).toFixed(1)}KB. Install pdf-parse for extraction.]`, numPages: 0, metadata: { file: filePath, size: stat.size } }
}

async function docTxt(input: { path: string; chunkSize?: number }) {
  const content = fs.readFileSync(resolveSafePath(input.path), 'utf-8')
  const chunkSize = input.chunkSize || 2000
  const chunks: string[] = []
  for (let i = 0; i < content.length; i += chunkSize) chunks.push(content.slice(i, i + chunkSize))
  return { text: content.slice(0, 10000), encoding: 'utf-8', chunks: chunks.slice(0, 5), totalLength: content.length }
}

async function docCsv(input: { path: string; limit?: number }) {
  const content = fs.readFileSync(resolveSafePath(input.path), 'utf-8')
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
  return { headers, rows: rows.slice(0, 20), totalRows: lines.length - 1, stats }
}

async function visionAnalyze(input: { imagePath?: string; imageUrl?: string; question?: string }) {
  const apiKeyRow = db.prepare("SELECT value FROM settings WHERE key='anthropic_api_key'").get() as any
  const apiKey = apiKeyRow?.value || process.env.ANTHROPIC_API_KEY || ''
  if (!apiKey) throw new Error('Anthropic API key required for vision analysis')
  const question = input.question || 'Describe this image in detail.'
  let imageData: string; let mediaType: string
  if (input.imagePath) {
    const filePath = resolveSafePath(input.imagePath)
    imageData = fs.readFileSync(filePath).toString('base64')
    const ext = path.extname(filePath).toLowerCase()
    mediaType = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
  } else if (input.imageUrl) {
    const res = await fetch(input.imageUrl, { signal: AbortSignal.timeout(10000) })
    imageData = Buffer.from(await res.arrayBuffer()).toString('base64')
    mediaType = res.headers.get('content-type') || 'image/jpeg'
  } else throw new Error('imagePath or imageUrl required')
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-3-5-sonnet-20241022', max_tokens: 1024, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: imageData } }, { type: 'text', text: question }] }] })
  })
  const data = await response.json() as any
  if (data.error) throw new Error(data.error.message)
  return { description: data.content?.[0]?.text || '', model: 'claude-3-5-sonnet-20241022' }
}

async function imageGen(input: { prompt: string; model?: string; size?: string; quality?: string; image?: string | string[]; responseFormat?: 'url' | 'b64_json'; saveTo?: string }) {
  return generateImage({
    model: input.model || 'dall-e-3',
    prompt: input.prompt,
    size: input.size,
    quality: input.quality,
    image: input.image,
    responseFormat: input.responseFormat,
    saveTo: input.saveTo,
  })
}

async function nodeRunner(input: { code: string; context?: object }) {
  const logs: string[] = []
  const sandbox = { ...(input.context || {}), console: { log: (...a: any[]) => logs.push(a.map(String).join(' ')), error: (...a: any[]) => logs.push('[ERR] ' + a.map(String).join(' ')) }, Math, JSON, Date, Array, Object, String, Number, Boolean, parseInt, parseFloat, isNaN, isFinite }
  try {
    const result = vm.runInNewContext(`(function(){ ${input.code} })()`, sandbox, { timeout: 5000, filename: 'skill.js' })
    return { result: result !== undefined ? result : null, logs, success: true }
  } catch (err: any) { return { result: null, logs, error: err.message, success: false } }
}

async function pythonRunner(input: { code: string }) {
  try {
    const { stdout, stderr } = await execFileAsync('python3', ['-c', input.code], { timeout: 10000, maxBuffer: 512 * 1024, env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: os.homedir() } })
    return { stdout, stderr, exitCode: 0 }
  } catch (err: any) { return { stdout: '', stderr: err.message || String(err), exitCode: 1 } }
}

async function shellRun(input: { command: string; cwd?: string }) {
  const perm = toolRepo.getPermission('shell')
  if (!perm?.granted || perm.scope !== 'permanent') throw new Error('Shell tool requires permanent permission grant.')
  try {
    const { stdout, stderr } = await execFileAsync('sh', ['-c', input.command], { cwd: input.cwd ? resolveSafePath(input.cwd) : os.homedir(), timeout: 10000, maxBuffer: 1024 * 1024 })
    return { stdout, stderr, exitCode: 0 }
  } catch (err: any) { return { stdout: '', stderr: err.message, exitCode: 1 } }
}
