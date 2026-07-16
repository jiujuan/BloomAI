# 🌸 BloomAI v0.2 — Sprout

> Local-first AI Desktop Assistant

---

## What's new in v0.2

Building on v0.1's chat engine, v0.2 adds the complete **Tools System**:

| Feature | Status |
|---|---|
| 22 built-in tools across 5 categories | ✅ |
| BaseTool-style executor with 15s timeout + persistence | ✅ |
| Three-tier permission system (readonly / write / shell) | ✅ |
| Permission dialogs (low/medium/high risk) | ✅ |
| Tool Call cards in chat (running/success/error states) | ✅ |
| Tool Management page (enable/disable, stats, search) | ✅ |
| Tool Detail page (schema viewer, run history) | ✅ |
| Tool Test Runner (manual parameter input + execution) | ✅ |
| Skills Market (8 official/community skills) | ✅ |
| Skill Editor (js-function / http-api / prompt-template) | ✅ |
| Skill install/uninstall from market | ✅ |
| All v0.1 features remain fully intact | ✅ |

---

## Tools Reference (22 total)

### 🌐 Web (4)
| Tool | Permission | Description |
|---|---|---|
| `web_search` | none | Search the web via DuckDuckGo Instant Answers |
| `web_fetch` | network | Fetch and extract text content from any URL |
| `web_screenshot` | network | Capture a webpage screenshot (stub — needs Playwright) |
| `web_extract` | network | Extract headings and links from a webpage |

### 📁 File System (6)
| Tool | Permission | Description |
|---|---|---|
| `fs_read` | fs | Read file contents with offset/limit |
| `fs_write` | write | Write or append to a file |
| `fs_edit` | write | Replace an exact unique string in a file |
| `fs_grep` | fs | Regex search across file(s) |
| `fs_glob` | fs | Find files by pattern |
| `bash` | shell | Execute whitelisted commands (ls, cat, grep, find…) |

### 📄 Document (5)
| Tool | Permission | Description |
|---|---|---|
| `doc_markdown` | fs | Parse Markdown → headings, code blocks, links |
| `doc_pdf` | fs | PDF metadata (stub — needs pdf-parse) |
| `doc_txt` | fs | Read + chunk plain text |
| `doc_csv` | fs | Parse CSV → rows + column statistics |
| `doc_docx` | fs | DOCX parsing (stub — needs mammoth) |

### 🖼️ Multimodal (4)
| Tool | Permission | Description |
|---|---|---|
| `vision` | network | Analyze images via Claude vision (real API call) |
| `ocr` | fs | OCR text extraction (stub — needs Tesseract) |
| `image_gen` | network | Generate images via DALL-E 3 (real API call) |
| `image_edit` | fs | Image editing (stub — needs sharp) |

### ⚡ Execution (3)
| Tool | Permission | Description |
|---|---|---|
| `node_runner` | sandbox | Run JS in a `node:vm` sandbox, 5s timeout |
| `python_runner` | sandbox | Run Python 3 in a subprocess, 10s timeout |
| `shell` | shell | Full shell access — requires **permanent** permission grant |

> **Note**: 5 tools (`web_screenshot`, `doc_pdf`, `doc_docx`, `ocr`, `image_edit`) return stub responses since their npm dependencies (playwright, pdf-parse, mammoth, tesseract.js, sharp) were intentionally **not** installed to keep the build lightweight and avoid native compilation. They are fully wired into the permission/execution/persistence pipeline and will work immediately once those packages are added.

---

## Skills Market (8 built-in)

| Skill | Type | Author | Description |
|---|---|---|---|
| Web Search | http-api | official | Search via SearXNG-compatible API |
| Text Summarizer | prompt-template | official | 3-5 bullet point summaries |
| Code Explainer | prompt-template | official | Step-by-step code explanations |
| Auto Translator | prompt-template | official | Multi-language translation |
| Keyword Extractor | js-function | official | Extract keywords + hashtags (runs in sandbox) |
| Readability Checker | prompt-template | community | Score + improve text readability |
| JSON Formatter | js-function | community | Validate + pretty-print JSON |
| Data Analyzer | js-function | community | Stats (mean/median/min/max) on number arrays |

---

## Quick Start

```bash
cd bloomai

# Install dependencies once
npm install --legacy-peer-deps --ignore-scripts

# Typecheck and build the migrated root app
npm run typecheck
npm run build

# Start the local API server
npm run start:server

# In another terminal, preview the built frontend
npx vite preview --host 127.0.0.1 --port 5174
# Visit http://127.0.0.1:5174
```

Configure your Anthropic API key in Settings to enable chat, vision, and prompt-template skills. Configure OpenAI key to enable `image_gen`.

---

## New API Endpoints (v0.2)

```
GET    /api/v1/tools                         # List all tools (with permission state)
GET    /api/v1/tools/stats                   # Global usage stats
GET    /api/v1/tools/runs                    # All tool run history
GET    /api/v1/tools/permissions             # All permission grants
POST   /api/v1/tools/permissions/:id/grant   # Grant permission {scope}
POST   /api/v1/tools/permissions/:id/revoke  # Revoke permission
GET    /api/v1/tools/:id                     # Tool detail + schema
PATCH  /api/v1/tools/:id                     # Enable/disable {is_enabled}
POST   /api/v1/tools/:id/run                 # Execute tool {input, sessionId}
GET    /api/v1/tools/:id/runs                # Tool-specific run history

GET    /api/v1/skills                        # Installed skills
GET    /api/v1/skills/market                 # Market skills (search + paginate)
POST   /api/v1/skills/install                # Install from market {id}
POST   /api/v1/skills                        # Create custom skill
GET    /api/v1/skills/:id                    # Skill detail
PATCH  /api/v1/skills/:id                    # Update custom skill
DELETE /api/v1/skills/:id                    # Uninstall/delete
POST   /api/v1/skills/:id/run                # Execute skill {input}
GET    /api/v1/skills/:id/runs               # Skill run history
```

---

## Architecture Notes

- **Drizzle ORM over node:sqlite**: Avoids native compilation entirely — works in any sandboxed/restricted environment without node-gyp.
- **Three-tier permissions**: `null`/`fs`/`network` (soft, auto-allowed), `write` (needs confirmation dialog), `shell` (needs explicit **permanent** grant via `/tools/permissions/shell/grant`).
- **vm sandbox for JS execution**: Both `node_runner` tool and `js-function` skills run inside `node:vm` contexts with no access to `require`, `process`, or the filesystem.
- **15-second hard timeout**: Every tool call races against a timeout via `Promise.race`, regardless of category.
- **All v0.1 data persists**: Sessions, messages, and personas are untouched — v0.2 is purely additive at the schema level.
- **Backend dependency boundary**: `src/server/http/routes/**` adapts HTTP only and calls `src/server/services/**`; Services orchestrate repositories and runtimes; `src/server/db/repositories/**` remains persistence-only. `npm run test:architecture` enforces Route → Service → Repository/Runtime boundaries across production server code. See `docs/services/01-service-layer-architecture-analysis.md` and `docs/services/03-http-route-application-service-adr.md`.
