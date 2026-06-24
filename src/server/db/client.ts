import { eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-sqlite'
import { createRequire } from 'node:module'
import { ensureDataDir, getDbPath } from './paths'
import * as schema from './schema'

const require = createRequire(import.meta.url)
type RawDb = { exec(sql: string): void }
type OrmDb = ReturnType<typeof drizzle<typeof schema>>
type DbState = {
  dbInstance: import('node:sqlite').DatabaseSync | null
  db: RawDb | null
  ormDb: OrmDb | null
}

const stateKey = Symbol.for('bloomai.db.state')
const globalState = globalThis as typeof globalThis & { [stateKey]?: DbState }

function getState() {
  globalState[stateKey] ??= { dbInstance: null, db: null, ormDb: null }
  return globalState[stateKey]
}

export let db: RawDb | null = getState().db
export let ormDb: OrmDb | null = getState().ormDb

function syncExports() {
  const state = getState()
  db = state.db
  ormDb = state.ormDb
}

export function getOrmDb() {
  const database = getState().ormDb
  if (!database) throw new Error('Database has not been initialized. Call runMigrations() before using repositories.')
  return database
}

export async function initDb() {
  const state = getState()
  if (state.dbInstance && state.db && state.ormDb) {
    syncExports()
    return state.db
  }

  ensureDataDir()
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
  state.dbInstance = new DatabaseSync(getDbPath())

  state.db = {
    exec(sql: string) { state.dbInstance!.exec(sql) },
  }

  state.ormDb = drizzle({ client: state.dbInstance, schema })
  syncExports()

  return state.db
}

export function closeDb() {
  const state = getState()
  state.dbInstance?.close()
  state.dbInstance = null
  state.db = null
  state.ormDb = null
  syncExports()
}

function runBootstrapSql() {
  const rawDb = getState().db
  if (!rawDb) throw new Error('Database has not been initialized. Call initDb() first.')

  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS personas (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, system_prompt TEXT NOT NULL,
      model_override TEXT, is_builtin INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'New Chat',
      persona_id TEXT, model TEXT NOT NULL DEFAULT 'claude-3-5-sonnet-20241022',
      status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
      content TEXT NOT NULL, tool_calls TEXT, tokens INTEGER, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
  `)

  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS llm_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      base_url TEXT,
      api_key_setting_key TEXT,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      config_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS llm_models (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      label TEXT NOT NULL,
      modality TEXT NOT NULL,
      capabilities_json TEXT NOT NULL DEFAULT '{}',
      is_enabled INTEGER NOT NULL DEFAULT 1,
      is_builtin INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS llm_video_tasks (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      model TEXT NOT NULL,
      provider_task_id TEXT,
      provider_video_id TEXT,
      input_json TEXT NOT NULL,
      output_json TEXT,
      status TEXT NOT NULL,
      progress INTEGER,
      error_msg TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)

  rawDb.exec(`
    CREATE TABLE IF NOT EXISTS tools (
      id TEXT PRIMARY KEY, category TEXT NOT NULL, name TEXT NOT NULL,
      description TEXT NOT NULL, params_schema TEXT NOT NULL DEFAULT '{}',
      result_schema TEXT NOT NULL DEFAULT '{}', is_builtin INTEGER DEFAULT 1,
      is_enabled INTEGER DEFAULT 1, requires_permission TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tool_runs (
      id TEXT PRIMARY KEY, tool_id TEXT NOT NULL, session_id TEXT,
      input_json TEXT NOT NULL, output_json TEXT, status TEXT NOT NULL,
      error_msg TEXT, duration_ms INTEGER, started_at INTEGER NOT NULL, finished_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS tool_permissions (
      id TEXT PRIMARY KEY, tool_id TEXT NOT NULL, granted INTEGER DEFAULT 0,
      granted_at INTEGER, scope TEXT DEFAULT 'session'
    );
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
      type TEXT NOT NULL, source TEXT NOT NULL, params_schema TEXT NOT NULL DEFAULT '{}',
      author TEXT, version TEXT DEFAULT '1.0.0', is_public INTEGER DEFAULT 0,
      is_installed INTEGER DEFAULT 1, install_count INTEGER DEFAULT 0, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS skill_runs (
      id TEXT PRIMARY KEY, skill_id TEXT NOT NULL, input_json TEXT NOT NULL,
      output_json TEXT, status TEXT NOT NULL, duration_ms INTEGER, created_at INTEGER NOT NULL
    );
  `)
}

function seedPersonas() {
  const database = getOrmDb()
  const count = database.select({ c: sql<number>`count(*)` }).from(schema.personas).where(eq(schema.personas.is_builtin, 1)).get()?.c || 0
  if (Number(count) > 0) return

  const now = Date.now()
  const personas = [
    ['developer', 'Developer', 'You are an expert software engineer. Help with code review, debugging, and architecture. Prefer TypeScript.', 'claude-3-5-sonnet-20241022'],
    ['writer', 'Writer', 'You are a professional content writer. Help with writing, editing, clarity and tone.', 'claude-3-5-sonnet-20241022'],
    ['analyst', 'Analyst', 'You are a data analyst. Provide precise insights with numbers.', 'claude-3-opus-20240229'],
    ['translator', 'Translator', 'You are a professional translator for Chinese, English, Japanese and Korean.', 'claude-3-5-sonnet-20241022'],
    ['coach', 'Coach', 'You are a life and productivity coach. Help with goals and decisions.', 'claude-3-5-sonnet-20241022'],
  ] as const

  for (const [id, name, system_prompt, model_override] of personas) {
    database.insert(schema.personas).values({ id, name, system_prompt, model_override, is_builtin: 1, created_at: now }).onConflictDoNothing().run()
  }
}

function seedSettings() {
  const database = getOrmDb()
  const now = Date.now()
  const settings = [
    ['model', 'claude-3-5-sonnet-20241022'], ['theme', 'system'],
    ['shortcut_overlay', 'Alt+Space'], ['anthropic_api_key', ''],
    ['openai_api_key', ''], ['agnes_api_key', ''], ['deepseek_api_key', ''],
    ['ollama_base_url', 'http://127.0.0.1:11434'],
    ['default_image_model', 'agnes-image-2.1-flash'], ['default_video_model', 'agnes-video-v2.0'],
    ['clipboard_monitoring', 'true'], ['context_awareness', 'true'],
  ] as const

  for (const [key, value] of settings) {
    database.insert(schema.settings).values({ key, value, updated_at: now }).onConflictDoNothing().run()
  }
}

function seedLlm() {
  const database = getOrmDb()
  const now = Date.now()
  const providers = [
    ['anthropic', 'Anthropic', 'anthropic', 'https://api.anthropic.com', 'anthropic_api_key'],
    ['openai', 'OpenAI', 'openai', 'https://api.openai.com/v1', 'openai_api_key'],
    ['agnes', 'Agnes', 'openai-compatible', 'https://apihub.agnes-ai.com/v1', 'agnes_api_key'],
    ['deepseek', 'DeepSeek', 'openai-compatible', 'https://api.deepseek.com/v1', 'deepseek_api_key'],
    ['ollama', 'Ollama', 'ollama', 'http://127.0.0.1:11434', null],
  ] as const

  for (const [id, name, kind, base_url, api_key_setting_key] of providers) {
    database.insert(schema.llm_providers).values({
      id,
      name,
      kind,
      base_url,
      api_key_setting_key,
      is_enabled: 1,
      config_json: '{}',
      created_at: now,
      updated_at: now,
    }).onConflictDoNothing().run()
  }

  const models = [
    ['claude-3-5-sonnet-20241022', 'anthropic', 'claude-3-5-sonnet-20241022', 'Claude 3.5 Sonnet', 'text', 10],
    ['claude-3-opus-20240229', 'anthropic', 'claude-3-opus-20240229', 'Claude 3 Opus', 'text', 20],
    ['claude-3-haiku-20240307', 'anthropic', 'claude-3-haiku-20240307', 'Claude 3 Haiku', 'text', 30],
    ['gpt-4o', 'openai', 'gpt-4o', 'GPT-4o', 'text', 40],
    ['gpt-4o-mini', 'openai', 'gpt-4o-mini', 'GPT-4o mini', 'text', 50],
    ['dall-e-3', 'openai', 'dall-e-3', 'DALL-E 3', 'image', 20],
    ['agnes-2.0-flash', 'agnes', 'agnes-2.0-flash', 'Agnes 2.0 Flash', 'text', 60],
    ['agnes-image-2.1-flash', 'agnes', 'agnes-image-2.1-flash', 'Agnes Image 2.1 Flash', 'image', 10],
    ['agnes-video-v2.0', 'agnes', 'agnes-video-v2.0', 'Agnes Video V2.0', 'video', 10],
    ['deepseek-chat', 'deepseek', 'deepseek-chat', 'DeepSeek Chat', 'text', 70],
    ['deepseek-reasoner', 'deepseek', 'deepseek-reasoner', 'DeepSeek Reasoner', 'text', 80],
  ] as const

  for (const [id, provider_id, model_id, label, modality, sort_order] of models) {
    database.insert(schema.llm_models).values({
      id,
      provider_id,
      model_id,
      label,
      modality,
      capabilities_json: '{}',
      is_enabled: 1,
      is_builtin: 1,
      sort_order,
      created_at: now,
      updated_at: now,
    }).onConflictDoNothing().run()
  }
}

function seedTools() {
  const database = getOrmDb()
  const count = database.select({ c: sql<number>`count(*)` }).from(schema.tools).where(eq(schema.tools.is_builtin, 1)).get()?.c || 0
  const now = Date.now()

  if (Number(count) === 0) {
    const tools = [
      ['web_search', 'web', 'Web Search', 'Search the web and return relevant results with titles, URLs and snippets.', '{"query":{"type":"string"},"limit":{"type":"number","default":8}}', '{"results":{"type":"array"}}', null],
      ['web_fetch', 'web', 'Web Fetch', 'Fetch and extract the main text content from a webpage URL.', '{"url":{"type":"string"},"mode":{"type":"string","enum":["text","html"],"default":"text"}}', '{"title":{"type":"string"},"content":{"type":"string"}}', 'network'],
      ['web_screenshot', 'web', 'Web Screenshot', 'Capture a full-page screenshot of any URL as PNG.', '{"url":{"type":"string"}}', '{"imagePath":{"type":"string"}}', 'network'],
      ['web_extract', 'web', 'Web Extract', 'Extract structured data (links, headings, tables) from a webpage.', '{"url":{"type":"string"},"selector":{"type":"string"}}', '{"headings":{"type":"array"},"links":{"type":"array"}}', 'network'],
      ['fs_read', 'fs', 'File Read', 'Read the contents of a local file with optional line range.', '{"path":{"type":"string"},"offset":{"type":"number"},"limit":{"type":"number"}}', '{"content":{"type":"string"},"totalLines":{"type":"number"}}', 'fs'],
      ['fs_write', 'fs', 'File Write', 'Write or append content to a local file.', '{"path":{"type":"string"},"content":{"type":"string"},"mode":{"type":"string","enum":["write","append"],"default":"write"}}', '{"bytesWritten":{"type":"number"}}', 'write'],
      ['fs_edit', 'fs', 'File Edit', 'Replace an exact unique string in a file.', '{"path":{"type":"string"},"oldText":{"type":"string"},"newText":{"type":"string"}}', '{"success":{"type":"boolean"},"linesChanged":{"type":"number"}}', 'write'],
      ['fs_grep', 'fs', 'File Grep', 'Search file(s) for a regex pattern, return matching lines with line numbers.', '{"pattern":{"type":"string"},"path":{"type":"string"},"recursive":{"type":"boolean"}}', '{"matches":{"type":"array"}}', 'fs'],
      ['fs_glob', 'fs', 'File Glob', 'Find files matching a glob pattern.', '{"pattern":{"type":"string"},"cwd":{"type":"string"}}', '{"files":{"type":"array"}}', 'fs'],
      ['bash', 'fs', 'Bash', 'Execute whitelisted shell commands (ls, cat, grep, find, head, tail, wc).', '{"command":{"type":"string"},"cwd":{"type":"string"}}', '{"stdout":{"type":"string"},"stderr":{"type":"string"},"exitCode":{"type":"number"}}', 'shell'],
      ['doc_markdown', 'document', 'Markdown Parser', 'Parse Markdown to extract headings, text, code blocks and links.', '{"path":{"type":"string"}}', '{"text":{"type":"string"},"headings":{"type":"array"},"codeBlocks":{"type":"array"}}', 'fs'],
      ['doc_pdf', 'document', 'PDF Parser', 'Extract text, page count and metadata from a PDF file.', '{"path":{"type":"string"},"pages":{"type":"array"}}', '{"text":{"type":"string"},"numPages":{"type":"number"},"metadata":{"type":"object"}}', 'fs'],
      ['doc_txt', 'document', 'Text File', 'Read plain text with auto encoding detection and chunking.', '{"path":{"type":"string"},"chunkSize":{"type":"number"}}', '{"text":{"type":"string"},"encoding":{"type":"string"},"chunks":{"type":"array"}}', 'fs'],
      ['doc_csv', 'document', 'CSV Parser', 'Parse CSV/TSV to rows with column stats.', '{"path":{"type":"string"},"limit":{"type":"number"}}', '{"headers":{"type":"array"},"rows":{"type":"array"},"stats":{"type":"object"}}', 'fs'],
      ['doc_docx', 'document', 'DOCX Parser', 'Convert .docx to plain text or HTML.', '{"path":{"type":"string"},"format":{"type":"string","enum":["text","html"],"default":"text"}}', '{"text":{"type":"string"},"html":{"type":"string"}}', 'fs'],
      ['vision', 'multimodal', 'Vision', 'Analyze image content and answer questions about what is in the image.', '{"imagePath":{"type":"string"},"imageUrl":{"type":"string"},"question":{"type":"string","default":"Describe this image in detail."}}', '{"description":{"type":"string"}}', 'network'],
      ['ocr', 'multimodal', 'OCR', 'Extract text from an image or screenshot using OCR.', '{"imagePath":{"type":"string"},"lang":{"type":"string","default":"eng"}}', '{"text":{"type":"string"},"confidence":{"type":"number"}}', 'fs'],
      ['image_gen', 'multimodal', 'Image Generator', 'Generate an image from a text prompt using DALL-E 3.', '{"prompt":{"type":"string"},"size":{"type":"string","default":"1024x1024"},"quality":{"type":"string","default":"standard"},"saveTo":{"type":"string"}}', '{"url":{"type":"string"},"localPath":{"type":"string"}}', 'network'],
      ['image_edit', 'multimodal', 'Image Editor', 'Resize, crop, convert format or compress an image using sharp.', '{"path":{"type":"string"},"ops":{"type":"array"},"outputPath":{"type":"string"}}', '{"outputPath":{"type":"string"},"size":{"type":"number"},"format":{"type":"string"}}', 'fs'],
      ['node_runner', 'execution', 'Node Runner', 'Execute JavaScript in a sandboxed vm context.', '{"code":{"type":"string"},"context":{"type":"object"}}', '{"result":{"type":"any"},"logs":{"type":"array"},"error":{"type":"string"}}', 'sandbox'],
      ['python_runner', 'execution', 'Python Runner', 'Run Python 3 code in a restricted subprocess with timeout.', '{"code":{"type":"string"},"packages":{"type":"array"}}', '{"stdout":{"type":"string"},"stderr":{"type":"string"},"exitCode":{"type":"number"}}', 'sandbox'],
      ['shell', 'execution', 'Shell', 'Full shell access - requires explicit permanent permission.', '{"command":{"type":"string"},"cwd":{"type":"string"},"env":{"type":"object"}}', '{"stdout":{"type":"string"},"stderr":{"type":"string"},"exitCode":{"type":"number"}}', 'shell'],
    ] as const

    for (const [id, category, name, description, params_schema, result_schema, requires_permission] of tools) {
      database.insert(schema.tools).values({ id, category, name, description, params_schema, result_schema, is_builtin: 1, is_enabled: 1, requires_permission, created_at: now }).onConflictDoNothing().run()
    }
  }

  database.update(schema.tools).set({
    params_schema: '{"prompt":{"type":"string"},"model":{"type":"string"},"size":{"type":"string","default":"1024x1024"},"quality":{"type":"string","default":"standard"},"image":{"type":"array"},"responseFormat":{"type":"string","enum":["url","b64_json"]},"saveTo":{"type":"string"}}',
    result_schema: '{"providerId":{"type":"string"},"model":{"type":"string"},"url":{"type":"string"},"b64_json":{"type":"string"},"localPath":{"type":"string"}}',
  }).where(eq(schema.tools.id, 'image_gen')).run()
}

function seedSkills() {
  const database = getOrmDb()
  const count = database.select({ c: sql<number>`count(*)` }).from(schema.skills).where(eq(schema.skills.author, 'official')).get()?.c || 0
  if (Number(count) > 0) return

  const now = Date.now()
  const skills = [
    ['web-search-skill', 'Web Search', 'Search the web and return results', 'http-api', JSON.stringify({ url: 'https://api.searxng.org/search?q={{query}}&format=json', method: 'GET' }), '{"query":{"type":"string","description":"Search query"}}', 'official', '1.0.0', 1, 1248],
    ['text-summarizer', 'Text Summarizer', 'Summarize any text into key points', 'prompt-template', 'Summarize the following text in 3-5 bullet points:\n\n{{text}}', '{"text":{"type":"string","description":"Text to summarize"}}', 'official', '1.0.0', 1, 892],
    ['code-explainer', 'Code Explainer', 'Explain what a code snippet does', 'prompt-template', 'Explain what this code does step by step:\n\n```\n{{code}}\n```', '{"code":{"type":"string","description":"Code snippet"}}', 'official', '1.0.0', 1, 634],
    ['translator-skill', 'Auto Translator', 'Translate text between languages', 'prompt-template', 'Translate the following text to {{targetLang}}. Only output the translation:\n\n{{text}}', '{"text":{"type":"string"},"targetLang":{"type":"string","description":"Target language"}}', 'official', '1.0.0', 1, 1103],
    ['keyword-extractor', 'Keyword Extractor', 'Extract keywords and hashtags from content', 'js-function', 'function run(input) {\n  const words = input.text.toLowerCase().split(/[\\s,£¬¡££¡£¿]+/).filter(w => w.length > 2)\n  const freq = {}\n  words.forEach(w => { freq[w] = (freq[w]||0)+1 })\n  const keywords = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,15).map(([w])=>w)\n  const hashtags = keywords.slice(0,10).map(k=>"#"+k)\n  return { keywords, hashtags, count: keywords.length }\n}', '{"text":{"type":"string","description":"Content to extract keywords from"}}', 'official', '1.0.0', 1, 421],
    ['readability-checker', 'Readability Checker', 'Check text readability and suggest improvements', 'prompt-template', 'Analyze the readability of this text. Score it 1-10 and give specific improvement suggestions:\n\n{{text}}', '{"text":{"type":"string","description":"Text to check"}}', 'community', '1.0.0', 1, 287],
    ['json-formatter', 'JSON Formatter', 'Format and validate JSON data', 'js-function', 'function run(input) {\n  try {\n    const parsed = JSON.parse(input.json)\n    return { formatted: JSON.stringify(parsed, null, 2), valid: true, keys: Object.keys(parsed).length }\n  } catch(e) { return { formatted: input.json, valid: false, error: e.message } }\n}', '{"json":{"type":"string","description":"JSON string to format"}}', 'community', '1.0.0', 1, 156],
    ['data-analyzer', 'Data Analyzer', 'Statistical analysis on CSV or array data', 'js-function', 'function run(input) {\n  const nums = input.data.filter(n=>typeof n==="number")\n  if(!nums.length) return { error: "No numeric data" }\n  const sum = nums.reduce((a,b)=>a+b,0)\n  const avg = sum/nums.length\n  const sorted = [...nums].sort((a,b)=>a-b)\n  return { count: nums.length, sum, avg: +avg.toFixed(4), min: sorted[0], max: sorted[sorted.length-1], median: sorted[Math.floor(sorted.length/2)] }\n}', '{"data":{"type":"array","description":"Array of numbers to analyze"}}', 'community', '1.0.0', 1, 198],
  ] as const

  for (const [id, name, description, type, source, params_schema, author, version, is_public, install_count] of skills) {
    database.insert(schema.skills).values({ id, name, description, type, source, params_schema, author, version, is_public, is_installed: 0, install_count, created_at: now }).onConflictDoNothing().run()
  }
}

export async function runMigrations() {
  await initDb()
  runBootstrapSql()
  seedPersonas()
  seedSettings()
  seedLlm()
  seedTools()
  seedSkills()
}
