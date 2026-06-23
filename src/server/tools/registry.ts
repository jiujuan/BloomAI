import type { ToolExecutor } from './types'
import { bashTool } from './bash'
import { docCsvTool } from './doc-csv'
import { docDocxTool } from './doc-docx'
import { docMarkdownTool } from './doc-markdown'
import { docPdfTool } from './doc-pdf'
import { docTxtTool } from './doc-txt'
import { fsEditTool } from './fs-edit'
import { fsGlobTool } from './fs-glob'
import { fsGrepTool } from './fs-grep'
import { fsReadTool } from './fs-read'
import { fsWriteTool } from './fs-write'
import { imageEditTool } from './image-edit'
import { imageGenTool } from './image-gen'
import { nodeRunnerTool } from './node-runner'
import { ocrTool } from './ocr'
import { pythonRunnerTool } from './python-runner'
import { shellTool } from './shell'
import { visionTool } from './vision'
import { webExtractTool } from './web-extract'
import { webFetchTool } from './web-fetch'
import { webScreenshotTool } from './web-screenshot'
import { webSearchTool } from './web-search'

export const toolRegistry: Record<string, ToolExecutor> = {
  web_search: webSearchTool,
  web_fetch: webFetchTool,
  web_screenshot: webScreenshotTool,
  web_extract: webExtractTool,
  fs_read: fsReadTool,
  fs_write: fsWriteTool,
  fs_edit: fsEditTool,
  fs_grep: fsGrepTool,
  fs_glob: fsGlobTool,
  bash: bashTool,
  doc_markdown: docMarkdownTool,
  doc_pdf: docPdfTool,
  doc_txt: docTxtTool,
  doc_csv: docCsvTool,
  doc_docx: docDocxTool,
  vision: visionTool,
  ocr: ocrTool,
  image_gen: imageGenTool,
  image_edit: imageEditTool,
  node_runner: nodeRunnerTool,
  python_runner: pythonRunnerTool,
  shell: shellTool,
}
