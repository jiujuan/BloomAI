import { z } from 'zod'
import { getToolAvailability, type ToolAvailability } from './availability'

export type ToolContract<I extends z.ZodTypeAny = z.ZodTypeAny, O extends z.ZodTypeAny = z.ZodTypeAny> = {
  id: string
  category: string
  displayName: string
  description: string
  requiresPermission?: 'fs' | 'network' | 'write' | 'shell' | 'sandbox'
  requiresWriteApproval?: boolean
  deprecated?: boolean
  replacement?: string
  inputSchema: I
  outputSchema: O
  getAvailability: () => Promise<ToolAvailability>
}

const pathSchema = z.string().min(1).max(4096)
const urlSchema = z.string().min(1).max(8192)
const outputObject = (shape: z.ZodRawShape) => z.object(shape).passthrough()

const webSearchInputSchema = z.object({
  query: z.string().min(1).max(10_000),
  limit: z.number().int().min(1).max(50).default(8),
}).strict()

const webFetchInputSchema = z.object({
  url: urlSchema,
  mode: z.enum(['text', 'html', 'full']).default('text'),
  maxChars: z.number().int().min(1).max(1_000_000).default(20_000),
  render: z.boolean().optional(),
  timeoutMs: z.number().int().min(1).max(120_000).default(20_000),
}).strict()

const webExtractInputSchema = z.object({
  url: urlSchema,
  maxChars: z.number().int().min(1).max(1_000_000).default(20_000),
  maxLinks: z.number().int().min(1).max(500).default(50),
  render: z.boolean().optional(),
  timeoutMs: z.number().int().min(1).max(120_000).default(20_000),
}).strict()

const webScreenshotInputSchema = z.object({
  url: urlSchema,
  fullPage: z.boolean().default(true),
  viewport: z.object({
    width: z.number().int().min(320).max(3840).default(1280),
    height: z.number().int().min(240).max(2160).default(720),
  }).default({ width: 1280, height: 720 }),
  format: z.enum(['png', 'jpeg']).default('png'),
  quality: z.number().int().min(1).max(100).optional(),
  timeoutMs: z.number().int().min(1).max(60_000).default(60_000),
}).strict().superRefine((value, context) => {
  if (value.format === 'png' && value.quality !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['quality'], message: 'quality is only supported for jpeg screenshots' })
  }
})

const fileReadInputSchema = z.object({
  path: pathSchema,
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(2_000).default(500),
}).strict()

const fileWriteInputSchema = z.object({
  path: pathSchema,
  content: z.string().max(10_000_000),
  mode: z.enum(['write', 'append']).default('write'),
}).strict()

const fileEditInputSchema = z.object({
  path: pathSchema,
  oldText: z.string().min(1).max(1_000_000),
  newText: z.string().max(1_000_000),
  expectedHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
}).strict()

const fileGrepInputSchema = z.object({
  pattern: z.string().min(1).max(10_000),
  path: pathSchema,
  recursive: z.boolean().default(false),
}).strict()

const fileGlobInputSchema = z.object({
  pattern: z.string().min(1).max(1_000),
  cwd: pathSchema.optional(),
}).strict()

const readOnlyBashCommands = ['ls', 'cat', 'grep', 'find', 'head', 'tail', 'pwd', 'wc', 'diff', 'sort', 'uniq', 'tr'] as const
const commandInputSchema = z.object({
  command: z.enum(readOnlyBashCommands),
  args: z.array(z.string().min(1).max(4_096)).max(32).default([]),
  cwd: pathSchema.optional(),
}).strict()

const fsStatInputSchema = z.object({
  path: pathSchema,
}).strict()

const workspaceSearchInputSchema = z.object({
  query: z.string().max(10_000).default(''),
  include: z.union([z.string().min(1).max(1_000), z.array(z.string().min(1).max(1_000)).max(32)]).optional(),
  exclude: z.union([z.string().min(1).max(1_000), z.array(z.string().min(1).max(1_000)).max(32)]).optional(),
  root: pathSchema.optional(),
  caseSensitive: z.boolean().default(false),
  maxResults: z.number().int().min(1).max(1_000).default(100),
  cursor: z.string().regex(/^\d+$/).optional(),
  mode: z.enum(['text', 'files']).default('text'),
}).strict()

const applyPatchInputSchema = z.object({
  patch: z.string().min(1).max(1_000_000),
  root: pathSchema.optional(),
  dryRun: z.boolean().default(true),
  createBackup: z.boolean().default(true),
  expectedHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  expectedHashes: z.record(z.string().regex(/^[a-f0-9]{64}$/i)).optional(),
}).strict()

const markdownInputSchema = z.object({ path: pathSchema }).strict()
const pdfInputSchema = z.object({
  path: pathSchema,
  pages: z.array(z.number().int().positive()).optional(),
}).strict()
const textInputSchema = z.object({
  path: pathSchema,
  chunkSize: z.number().int().min(1).max(100_000).default(2_000),
}).strict()
const csvInputSchema = z.object({
  path: pathSchema,
  limit: z.number().int().min(1).max(10_000).default(100),
}).strict()
const docxInputSchema = z.object({
  path: pathSchema,
  format: z.enum(['text', 'html']).default('text'),
}).strict()

const visionInputSchema = z.object({
  imagePath: pathSchema.optional(),
  imageUrl: urlSchema.optional(),
  question: z.string().min(1).max(20_000).default('Describe this image in detail.'),
}).strict().refine(
  (value) => (value.imagePath ? 1 : 0) + (value.imageUrl ? 1 : 0) === 1,
  { message: 'Exactly one of imagePath or imageUrl is required', path: ['imagePath'] },
)

const imageGenerationInputSchema = z.object({
  prompt: z.string().min(1).max(100_000),
  model: z.string().min(1).max(200).optional(),
  size: z.string().min(1).max(100).optional(),
  quality: z.string().min(1).max(100).optional(),
  image: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
  responseFormat: z.enum(['url', 'b64_json']).optional(),
  saveTo: pathSchema.optional(),
}).strict()

const imageEditInputSchema = z.object({
  path: pathSchema,
  ops: z.array(z.unknown()).default([]),
  outputPath: pathSchema.optional(),
}).strict()

const nodeRunnerInputSchema = z.object({
  code: z.string().min(1).max(100_000),
  context: z.record(z.unknown()).optional(),
}).strict()

const pythonRunnerInputSchema = z.object({
  code: z.string().min(1).max(100_000),
  packages: z.array(z.string().min(1).max(200)).optional(),
}).strict()

const shellInputSchema = z.object({
  command: z.string().min(1).max(100_000),
  cwd: pathSchema.optional(),
  env: z.record(z.string()).optional(),
}).strict()

const searchResultSchema = z.object({
  title: z.string().optional(),
  url: z.string().optional(),
  snippet: z.string().optional(),
}).passthrough()

export const toolContracts = {
  web_search: {
    id: 'web_search',
    category: 'web',
    displayName: 'Web Search',
    description: 'Search the web and return relevant results with titles, URLs and snippets.',
    inputSchema: webSearchInputSchema,
    outputSchema: outputObject({
      query: z.string().optional(),
      total: z.number().int().nonnegative().optional(),
      results: z.array(searchResultSchema).optional(),
      provider: z.enum(['tavily', 'duckduckgo']).optional(),
      fallbackFrom: z.literal('tavily').optional(),
      fallbackReason: z.string().optional(),
      error: z.string().optional(),
    }),
    getAvailability: async () => getToolAvailability('web_search'),
  },
  web_fetch: {
    id: 'web_fetch',
    category: 'web',
    displayName: 'Web Fetch',
    description: 'Fetch a webpage and return its readable main text.',
    requiresPermission: 'network',
    inputSchema: webFetchInputSchema,
    outputSchema: outputObject({
      title: z.string().optional(),
      content: z.string().optional(),
      url: z.string().optional(),
      finalUrl: z.string().optional(),
      status: z.number().int().optional(),
      charset: z.string().optional(),
      description: z.string().optional(),
      truncated: z.boolean().optional(),
      rendered: z.boolean().optional(),
    }),
    getAvailability: async () => getToolAvailability('web_fetch'),
  },
  web_screenshot: {
    id: 'web_screenshot',
    category: 'web',
    displayName: 'Web Screenshot',
    description: 'Capture a full-page screenshot of a URL as a PNG artifact.',
    requiresPermission: 'network',
    inputSchema: webScreenshotInputSchema,
    outputSchema: outputObject({
      imagePath: z.string().optional(),
      mimeType: z.enum(['image/png', 'image/jpeg']).optional(),
      width: z.number().int().optional(),
      height: z.number().int().optional(),
      bytes: z.number().int().nonnegative().optional(),
      finalUrl: z.string().optional(),
      provider: z.enum(['agent_browser', 'playwright_legacy']).optional(),
      diagnostics: z.object({
        attempts: z.array(z.object({
          provider: z.string(),
          outcome: z.string(),
          reason: z.string().optional(),
          durationMs: z.number().optional(),
        }).passthrough()),
        blockedRequests: z.number().int().nonnegative().optional(),
      }).passthrough().optional(),
    }),
    getAvailability: async () => getToolAvailability('web_screenshot'),
  },
  web_extract: {
    id: 'web_extract',
    category: 'web',
    displayName: 'Web Extract',
    description: 'Extract structured metadata, headings, links, and main text from a webpage.',
    requiresPermission: 'network',
    inputSchema: webExtractInputSchema,
    outputSchema: outputObject({
      title: z.string().optional(),
      description: z.string().optional(),
      finalUrl: z.string().optional(),
      headings: z.array(z.string()).optional(),
      links: z.array(z.object({ url: z.string().optional(), text: z.string().optional() }).passthrough()).optional(),
      text: z.string().optional(),
      truncated: z.boolean().optional(),
      rendered: z.boolean().optional(),
      byline: z.string().optional(),
      publishedAt: z.string().optional(),
      canonicalUrl: z.string().optional(),
    }),
    getAvailability: async () => getToolAvailability('web_extract'),
  },
  fs_read: {
    id: 'fs_read',
    category: 'fs',
    displayName: 'File Read',
    description: 'Read the contents of a local file with an optional line range.',
    requiresPermission: 'fs',
    inputSchema: fileReadInputSchema,
    outputSchema: outputObject({
      content: z.string().optional(),
      totalLines: z.number().int().nonnegative().optional(),
      path: z.string().optional(),
      truncated: z.boolean().optional(),
    }),
    getAvailability: async () => getToolAvailability('fs_read'),
  },
  fs_write: {
    id: 'fs_write',
    category: 'fs',
    displayName: 'File Write',
    description: 'Write or append content to a local file.',
    requiresPermission: 'write',
    inputSchema: fileWriteInputSchema,
    outputSchema: outputObject({ bytesWritten: z.number().int().nonnegative().optional(), path: z.string().optional() }),
    getAvailability: async () => getToolAvailability('fs_write'),
  },
  fs_edit: {
    id: 'fs_edit',
    category: 'fs',
    displayName: 'File Edit',
    description: 'Replace an exact unique string in a local file.',
    requiresPermission: 'write',
    inputSchema: fileEditInputSchema,
    outputSchema: outputObject({ success: z.boolean().optional(), linesChanged: z.number().int().nonnegative().optional() }),
    getAvailability: async () => getToolAvailability('fs_edit'),
  },
  fs_stat: {
    id: 'fs_stat',
    category: 'fs',
    displayName: 'File Stat',
    description: 'Return bounded metadata for a local file, directory, or symlink.',
    requiresPermission: 'fs',
    inputSchema: fsStatInputSchema,
    outputSchema: outputObject({
      path: z.string(),
      type: z.enum(['file', 'directory', 'symlink']),
      size: z.number().nonnegative(),
      modifiedAt: z.string(),
      extension: z.string().optional(),
      isBinary: z.boolean().optional(),
    }),
    getAvailability: async () => getToolAvailability('fs_stat'),
  },
  workspace_search: {
    id: 'workspace_search',
    category: 'fs',
    displayName: 'Workspace Search',
    description: 'Search approved workspace files by text or glob with bounded pagination.',
    requiresPermission: 'fs',
    inputSchema: workspaceSearchInputSchema,
    outputSchema: outputObject({
      mode: z.enum(['text', 'files']),
      results: z.array(outputObject({
        file: z.string(),
        relativePath: z.string(),
        line: z.number().int().positive().optional(),
        column: z.number().int().positive().optional(),
        preview: z.string().optional(),
        ranges: z.array(outputObject({
          start: z.number().int().nonnegative(),
          end: z.number().int().nonnegative(),
        })).optional(),
        size: z.number().nonnegative().optional(),
        modifiedAt: z.string().optional(),
      })),
      total: z.number().int().nonnegative(),
      scannedFiles: z.number().int().nonnegative(),
      skippedFiles: z.number().int().nonnegative(),
      resourceLimited: z.boolean(),
      truncated: z.boolean(),
      nextCursor: z.string().optional(),
    }),
    getAvailability: async () => getToolAvailability('workspace_search'),
  },
  fs_apply_patch: {
    id: 'fs_apply_patch',
    category: 'fs',
    displayName: 'Apply Patch',
    description: 'Preview or atomically apply a unified patch inside an approved workspace.',
    requiresPermission: 'fs',
    requiresWriteApproval: true,
    inputSchema: applyPatchInputSchema,
    outputSchema: outputObject({
      dryRun: z.boolean(),
      applied: z.boolean(),
      files: z.array(outputObject({
        path: z.string(),
        relativePath: z.string(),
        hunks: z.number().int().nonnegative(),
        linesAdded: z.number().int().nonnegative(),
        linesRemoved: z.number().int().nonnegative(),
        backupPath: z.string().optional(),
        rollbackToken: z.string().optional(),
      })),
      conflicts: z.array(outputObject({
        path: z.string().optional(),
        relativePath: z.string(),
        reason: z.string(),
        detail: z.string().optional(),
      })),
      rollbackToken: z.string().optional(),
    }),
    getAvailability: async () => getToolAvailability('fs_apply_patch'),
  },
  fs_grep: {
    id: 'fs_grep',
    category: 'fs',
    displayName: 'File Grep',
    description: 'Search file or files for a regular expression and return matching lines.',
    requiresPermission: 'fs',
    inputSchema: fileGrepInputSchema,
    outputSchema: outputObject({
      matches: z.array(outputObject({ file: z.string().optional(), line: z.number().int().positive().optional(), text: z.string().optional() })).optional(),
      total: z.number().int().nonnegative().optional(),
    }),
    deprecated: true,
    replacement: 'workspace_search',
    getAvailability: async () => getToolAvailability('fs_grep'),
  },
  fs_glob: {
    id: 'fs_glob',
    category: 'fs',
    displayName: 'File Glob',
    description: 'Find files matching a glob pattern.',
    requiresPermission: 'fs',
    inputSchema: fileGlobInputSchema,
    outputSchema: outputObject({
      files: z.array(outputObject({ path: z.string().optional(), relativePath: z.string().optional(), size: z.number().optional(), mtime: z.number().optional() })).optional(),
      total: z.number().int().nonnegative().optional(),
      cwd: z.string().optional(),
    }),
    deprecated: true,
    replacement: 'workspace_search',
    getAvailability: async () => getToolAvailability('fs_glob'),
  },
  bash: {
    id: 'bash',
    category: 'fs',
    displayName: 'Bash',
    description: 'Execute a small allowlisted set of shell commands.',
    requiresPermission: 'shell',
    inputSchema: commandInputSchema,
    outputSchema: outputObject({
      stdout: z.string().optional(),
      stderr: z.string().optional(),
      exitCode: z.number().int().optional(),
      stdoutTruncated: z.boolean().optional(),
      stderrTruncated: z.boolean().optional(),
      errorCode: z.string().optional(),
    }),
    getAvailability: async () => getToolAvailability('bash'),
  },
  doc_markdown: {
    id: 'doc_markdown',
    category: 'document',
    displayName: 'Markdown Parser',
    description: 'Parse Markdown to extract headings, text, code blocks, and links.',
    requiresPermission: 'fs',
    inputSchema: markdownInputSchema,
    outputSchema: outputObject({
      text: z.string().optional(),
      headings: z.array(z.string()).optional(),
      codeBlocks: z.array(z.string()).optional(),
      links: z.array(z.string()).optional(),
      truncated: z.boolean().optional(),
    }),
    getAvailability: async () => getToolAvailability('doc_markdown'),
  },
  doc_pdf: {
    id: 'doc_pdf',
    category: 'document',
    displayName: 'PDF Parser',
    description: 'Extract text, page count, and metadata from a PDF file.',
    requiresPermission: 'fs',
    inputSchema: pdfInputSchema,
    outputSchema: outputObject({ text: z.string().optional(), numPages: z.number().int().nonnegative().optional(), metadata: z.record(z.unknown()).optional() }),
    getAvailability: async () => getToolAvailability('doc_pdf'),
  },
  doc_txt: {
    id: 'doc_txt',
    category: 'document',
    displayName: 'Text File',
    description: 'Read plain text with bounded chunking.',
    requiresPermission: 'fs',
    inputSchema: textInputSchema,
    outputSchema: outputObject({
      text: z.string().optional(),
      encoding: z.string().optional(),
      chunks: z.array(z.string()).optional(),
      totalLength: z.number().int().nonnegative().optional(),
      truncated: z.boolean().optional(),
    }),
    getAvailability: async () => getToolAvailability('doc_txt'),
  },
  doc_csv: {
    id: 'doc_csv',
    category: 'document',
    displayName: 'CSV Parser',
    description: 'Parse CSV rows and calculate basic column statistics.',
    requiresPermission: 'fs',
    inputSchema: csvInputSchema,
    outputSchema: outputObject({
      headers: z.array(z.string()).optional(),
      rows: z.array(z.array(z.string())).optional(),
      totalRows: z.number().int().nonnegative().optional(),
      stats: z.record(z.unknown()).optional(),
      truncated: z.boolean().optional(),
    }),
    getAvailability: async () => getToolAvailability('doc_csv'),
  },
  doc_docx: {
    id: 'doc_docx',
    category: 'document',
    displayName: 'DOCX Parser',
    description: 'Convert a DOCX document to plain text or HTML.',
    requiresPermission: 'fs',
    inputSchema: docxInputSchema,
    outputSchema: outputObject({ text: z.string().optional(), html: z.string().optional() }),
    getAvailability: async () => getToolAvailability('doc_docx'),
  },
  vision: {
    id: 'vision',
    category: 'multimodal',
    displayName: 'Vision',
    description: 'Analyze an image and answer a question about its contents.',
    requiresPermission: 'network',
    inputSchema: visionInputSchema,
    outputSchema: outputObject({ description: z.string().optional(), model: z.string().optional() }),
    getAvailability: async () => getToolAvailability('vision'),
  },
  ocr: {
    id: 'ocr',
    category: 'multimodal',
    displayName: 'OCR',
    description: 'Extract text from an image using an OCR backend.',
    requiresPermission: 'fs',
    inputSchema: z.object({ imagePath: pathSchema.optional(), lang: z.string().min(1).max(40).default('eng') }).strict(),
    outputSchema: outputObject({ text: z.string().optional(), confidence: z.number().min(0).max(1).optional() }),
    getAvailability: async () => getToolAvailability('ocr'),
  },
  image_gen: {
    id: 'image_gen',
    category: 'multimodal',
    displayName: 'Image Generator',
    description: 'Generate an image from a text prompt.',
    requiresPermission: 'network',
    inputSchema: imageGenerationInputSchema,
    outputSchema: outputObject({
      providerId: z.string().optional(),
      model: z.string().optional(),
      url: z.string().optional(),
      b64_json: z.string().optional(),
      localPath: z.string().optional(),
    }),
    getAvailability: async () => getToolAvailability('image_gen'),
  },
  image_edit: {
    id: 'image_edit',
    category: 'multimodal',
    displayName: 'Image Editor',
    description: 'Edit an image using the configured image-processing backend.',
    requiresPermission: 'fs',
    inputSchema: imageEditInputSchema,
    outputSchema: outputObject({ outputPath: z.string().optional(), size: z.number().optional(), format: z.string().optional() }),
    getAvailability: async () => getToolAvailability('image_edit'),
  },
  node_runner: {
    id: 'node_runner',
    category: 'execution',
    displayName: 'Node Runner',
    description: 'Execute JavaScript in a restricted VM context. This is not an OS sandbox and remains disabled until C2 isolation acceptance.',
    requiresPermission: 'sandbox',
    inputSchema: nodeRunnerInputSchema,
    outputSchema: outputObject({ result: z.unknown().optional(), logs: z.array(z.string()).optional(), error: z.string().optional(), success: z.boolean().optional() }),
    getAvailability: async () => getToolAvailability('node_runner'),
  },
  python_runner: {
    id: 'python_runner',
    category: 'execution',
    displayName: 'Python Runner',
    description: 'Run Python code in a controlled subprocess. Dependency installation is disabled until C2 isolation acceptance.',
    requiresPermission: 'sandbox',
    inputSchema: pythonRunnerInputSchema,
    outputSchema: outputObject({
      stdout: z.string().optional(),
      stderr: z.string().optional(),
      exitCode: z.number().int().optional(),
      stdoutTruncated: z.boolean().optional(),
      stderrTruncated: z.boolean().optional(),
    }),
    getAvailability: async () => getToolAvailability('python_runner'),
  },
  shell: {
    id: 'shell',
    category: 'execution',
    displayName: 'Shell',
    description: 'Run a shell command with explicit permission after a cross-platform OS isolation boundary is accepted.',
    requiresPermission: 'shell',
    inputSchema: shellInputSchema,
    outputSchema: outputObject({
      stdout: z.string().optional(),
      stderr: z.string().optional(),
      exitCode: z.number().int().optional(),
      stdoutTruncated: z.boolean().optional(),
      stderrTruncated: z.boolean().optional(),
    }),
    getAvailability: async () => getToolAvailability('shell'),
  },
} satisfies Record<string, ToolContract>

export type BuiltinToolId = keyof typeof toolContracts

export function getToolContract(toolId: string): ToolContract | undefined {
  return toolContracts[toolId as BuiltinToolId]
}

/**
 * The UI consumes the same contract as Agent and HTTP, but needs a small
 * JSON-compatible field map instead of Zod internals.
 */
export function schemaToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const value = schemaToJsonValue(schema)
  if (isRecord(value) && value.type === 'object' && isRecord(value.properties)) {
    return value.properties
  }
  return isRecord(value) ? value : {}
}

function schemaToJsonValue(schema: z.ZodTypeAny): unknown {
  const definition = getDefinition(schema)
  const typeName = definition.typeName

  if (typeName === 'ZodOptional') {
    return schemaToJsonValue(getSchema(definition.innerType))
  }
  if (typeName === 'ZodDefault') {
    const result = schemaToJsonValue(getSchema(definition.innerType))
    if (isRecord(result)) {
      const getDefault = definition.defaultValue
      if (typeof getDefault === 'function') result.default = getDefault()
    }
    return result
  }
  if (typeName === 'ZodNullable') {
    const result = schemaToJsonValue(getSchema(definition.innerType))
    if (isRecord(result)) result.nullable = true
    return result
  }
  if (typeName === 'ZodEffects' || typeName === 'ZodBranded' || typeName === 'ZodReadonly') {
    return schemaToJsonValue(getSchema(definition.schema ?? definition.type))
  }
  if (typeName === 'ZodObject') {
    const getShape = definition.shape
    const shape = typeof getShape === 'function' ? getShape() as Record<string, z.ZodTypeAny> : {}
    const properties: Record<string, unknown> = {}
    for (const [key, property] of Object.entries(shape)) properties[key] = schemaToJsonValue(property)
    return { type: 'object', properties }
  }
  if (typeName === 'ZodString') {
    const result: Record<string, unknown> = { type: 'string' }
    addChecks(result, definition.checks)
    return result
  }
  if (typeName === 'ZodNumber') {
    const result: Record<string, unknown> = { type: 'number' }
    addChecks(result, definition.checks)
    return result
  }
  if (typeName === 'ZodBoolean') return { type: 'boolean' }
  if (typeName === 'ZodArray') return { type: 'array', items: schemaToJsonValue(getSchema(definition.type)) }
  if (typeName === 'ZodEnum') return { type: 'string', enum: Array.isArray(definition.values) ? definition.values : [] }
  if (typeName === 'ZodLiteral') return { type: typeof definition.value, enum: [definition.value] }
  if (typeName === 'ZodRecord') return { type: 'object', additionalProperties: true }
  if (typeName === 'ZodUnion') {
    const options = Array.isArray(definition.options) ? definition.options : []
    return { anyOf: options.map((option) => schemaToJsonValue(getSchema(option))) }
  }
  if (typeName === 'ZodTuple') {
    const items = Array.isArray(definition.items) ? definition.items : []
    return { type: 'array', items: items.map((item) => schemaToJsonValue(getSchema(item))) }
  }
  if (typeName === 'ZodAny' || typeName === 'ZodUnknown') return {}
  return {}
}

function addChecks(target: Record<string, unknown>, checks: unknown): void {
  if (!Array.isArray(checks)) return
  const numeric = target.type === 'number'
  for (const check of checks) {
    if (!isRecord(check)) continue
    if (check.kind === 'int') target.type = 'integer'
    if (check.kind === 'min' && typeof check.value === 'number') {
      if (numeric) target.minimum = check.value
      else target.minLength = check.value
    }
    if (check.kind === 'max' && typeof check.value === 'number') {
      if (numeric) target.maximum = check.value
      else target.maxLength = check.value
    }
  }
}

function getDefinition(schema: z.ZodTypeAny): Record<string, unknown> {
  return (schema as unknown as { _def: Record<string, unknown> })._def
}

function getSchema(value: unknown): z.ZodTypeAny {
  return value as z.ZodTypeAny
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
