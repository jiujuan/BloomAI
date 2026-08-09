## docs url

https://www.anysearch.com/docs#response-format

## API Base URL

`https://api.anysearch.com`

## curl 调用

AI 统一搜索基础设施

API Base URL`https://api.anysearch.com`

只需两步，即可将强大的 AI 搜索能力接入您的应用：通过控制台获取 API Key（或直接匿名调用体验免费额度），然后发起您的第一次搜索请求。

```json
# 注意：通过 MCP / Skill 方式使用时，AI 代理会自动处理参数路由。直接调用 API 时，开发者需根据使用场景手动填写合适的 tag 和 params，以获得最佳搜索效果。

curl -X POST https://api.anysearch.com/v1/search \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Go 1.26 release notes",
    "tag": "code.doc",
    "params": {"library": "golang"},
    "max_results": 10
   }' 
```



```bash
# 注意：通过 MCP / Skill 方式使用时，AI 代理会自动处理参数路由。直接调用 API 时，开发者需根据使用场景手动填写合适的 tag 和 params，以获得最佳搜索效果。

curl -X POST https://api.anysearch.com/v1/search \
  -H "Authorization: Bearer YOUR_ANYSEARCH_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Go 1.26 release notes",
    "tag": "code.doc",
    "params": {"library": "golang"},
    "max_results": 10
  }'  
```



## 认证

AnySearch 搜索 API (/v1/*) 支持灵活的认证策略，您可以根据业务阶段选择是否携带 API Key：

调用方式Header 格式额度与限流规则

匿名调用不提供 Authorization 头按客户端 IP 维度进行限流，并消耗每日免费额度 (Daily Free Quota)

认证调用Authorization: Bearer YOUR_ANYSEARCH_API_KEY按 API Key 绑定的付费额度计费，享有更高的并发限流阈值

注意：如果您在请求中携带了 Authorization 头但 Key 非法、已禁用或已过期，系统将返回 401 Unauthorized 或 403 Forbidden，而不会降级为匿名调用。



## API 接口

POST/v1/search

统一搜索接口。根据查询意图自动路由至最佳数据源，并对结果进行融合排序。

可选 API Key 认证（匿名按 IP 限流并消耗每日免费额度）

请求参数

字段类型必须描述

querystring必选搜索查询

max_resultsint非必选返回结果数量，例如 10，默认 10，范围 1–20

tagstring非必选子域能力标签，单个值，格式为 {domain}.{sub_domain}，例如 "code.doc"

zonestring非必选地区，取值为 cn 或 intl

languagestring非必选偏好语言，例如 zh-CN 或 en

paramsobject非必选透传给 AnyMix 的扩展参数，例如 {"ticker": "AAPL"}

formatstring非必选输出格式，取值为 json 或 markdown

请求示例

bash复制

curl -X POST https://api.anysearch.com/v1/search \

  -H "Authorization: Bearer YOUR_ANYSEARCH_API_KEY" \

  -H "Content-Type: application/json" \

  -d '{

​    "query": "Go 1.26 release notes",

​    "max_results": 10

  }'

请求示例（带参数）

bash复制

curl -X POST https://api.anysearch.com/v1/search \

  -H "Authorization: Bearer YOUR_ANYSEARCH_API_KEY" \

  -H "Content-Type: application/json" \

  -d '{

​    "query": "Go 1.26 release notes",

​    "tag": "code.doc",

​    "params": {"library": "golang"},

​    "max_results": 10

  }

## 响应格式

成功的 200 请求会返回包含 results 数组和 metadata 的 JSON 结构。

Results 字段说明

字段名说明

title (string)结果标题

url (string)原始来源 URL

snippet (string)简短摘要

content (string)清洗后的正文内容

Metadata 字段说明

字段名说明

total_results (int)返回的结果总数

search_time_ms (int)搜索总耗时（毫秒）

完整响应示例

json复制

{

  "code": 0,

  "message": "success",

  "request_id": "a035db5c-2380-4c1d-900d-15c3d1f41a5a",

  "data": {

​    "results": [

​      {

​        "title": "Go 1.26 Release Notes",

​        "url": "https://go.dev/doc/go1.26",

​        "snippet": "Go 1.26 is a major release...",

​        "content": "Detailed content here..."

​      }

​    ],

​    "metadata": {

​      "total_results": 10,

​      "search_time_ms": 946

​    }

  }

}

错误响应示例

json复制

{

​    "code": -1,

​    "message": "Missing required params for tag 'code.doc': library.",

​    "request_id": "a035db5c-2380-4c1d-900d-15c3d1f41a5a",

}

## 错误码

所有错误响应均包含 request_id 字段。429 响应额外包含 Retry-After 和 X-RateLimit-* 响应头。

状态码symbol说明

400invalid_request请求体非法、query 为空、tag / zone / format等字段值非法

400invalid_extract_urlextract 工具的 url 缺失、scheme 非 http/https、URL 解析失败、缺少 host

401invalid_api_keyAPI Key 不存在、已禁用、未绑定账号或账号缺失

401invalid_auth_headerAuthorization 头格式不合法（不是 Bearer xxx 形式）

402daily_free_quota_exhausted匿名 IP 当日免费额度已用尽；响应中会带自动注册账号信息（username / password / api_key），可直接使用该 Key 继续调用

402quota_exhaustedAPI Key 或账号当前周期付费额度已用尽，data 含 quota_limit / quota_used / quota_remaining

402user_daily_quota_exhausted注册用户当日免费额度已用尽，且账号未购买付费额度，需等次日重置或购买套餐

403expired_api_keyAPI Key 已过期

403private_capability_not_enabled当前 API Key 未启用所请求的私有 capability，需联系运营开通

403account_disabledAPI Key 关联账号已被禁用

415extract_unsupported_contentextract 目标响应 Content-Type 不是 text/html

429rate_limit_exceeded_user账号维度聚合限流（同一账号下所有 Key 合并计算）触发

429rate_limit_exceeded单个 API Key 或匿名 IP 维度限流触发，data 含 retry_after / limit / remaining / reset_at

500internal_error服务端内部错误，可重试

502extract_fetch_failedextract 抓取失败：DNS / TCP / TLS / 读 body / 解析 HTML 等层面错误（非超时）

502extract_upstream_errorextract 目标站返回非 2xx HTTP 响应

503quota_check_failed额度检查依赖暂不可用，建议短暂退避后重试

503guard_evaluate_failedGuard 评估阶段依赖（KeyStore / 限流器等）返回错误，建议短暂退避后重试

503capability_temporarily_unavailable所请求的能力（含底层插件后端）暂时不可用，建议退避重试

503service_unavailable服务暂时不可用，建议退避重试

504extract_timeoutextract 抓取超时（默认 30s 上限）

## Tags & Params

全部academicagriculturebusinesscodeenergyenvironmentfilmfinancegaminggeneralhealthiplegalresourcesecuritysocial_mediatravel

### academic

academic.biomedical生物医学文献8 参数−

参数必填说明

date_type可选Date filter dimension. Values: `pdat` (publication date, default), `edat` (entry date), `mdat` (modification date)

field可选Query field restriction. Values: `tiab` (title+abstract, default), `title` (title only), `author` (author), `journal` (journal), `mesh` (MeSH terms), `all` (all fields). Used to control PubMed field tags during query rewriting, avoiding ambiguity from automatic MeSH expansion.

has_pdf可选Whether to return only publications with PDF full text.

open_access可选Whether to return only open access publications.

sort可选Sort order. Values: `relevance` (default, PubMed Best Match), `date` (newest first), `pub_date` (publication date), `author` (author surname), `journal` (journal name), `cited` (by citation count).

source可选Data sub-database filter. Values: `MED` (PubMed/MEDLINE), `PMC` (PMC full text), `PPR` (preprints bioRxiv/medRxiv), `AGR` (Agricola agriculture), `PAT` (patents), etc.

year_from可选Publication year/date lower bound. Format `YYYY` or `YYYY/MM/DD`.

year_to可选Publication year/date upper bound. Format `YYYY` or `YYYY/MM/DD`.

academic.citation引用关系查询13 参数−

参数必填说明

id必填Persistent identifier value extracted from user input. Do NOT include type prefixes like "doi:" or "pmid:". Formats: DOI (e.g. 10.1038/s41586-021-03819-2), PMID (pure digits, e.g. 33817056), ISSN (e.g. 0138-9130), ISBN (e.g. 9781402096327), ORCID (e.g. 0000-0003-0530-4305), OMID (e.g. br/06101801781), OCI (digits-digits, e.g. 06101801781-06180334099, only for op=citation).

category可选Subject category, comma-separated multi-value. Valid values (22): `Computer Science`, `Medicine`, `Biology`, `Chemistry`, `Physics`, `Mathematics`, `Materials Science`, `Engineering`, `Environmental Science`, `Geology`, `Geography`, `Sociology`, `Psychology`, `Economics`, `Business`, `Political Science`, `Linguistics`, `Philosophy`, `History`, `Art`, `Education`, `Law`.

doi可选DOI identifier, e.g. 10.1038/s41586-021-03819-2

filter可选RAMOSE filter expression. Format: `field:value`, e.g., `creation:2020-*-*` (citations after 2020).

id_type可选Identifier type. Values: `doi`, `pmid`, `issn`, `isbn`, `orcid`, `omid`. When empty, auto-detected from query format (e.g., `10.xxx/yyy` → doi, pure digits → pmid).

min_citations可选Minimum citation count, non-negative integer string, e.g., `100`. Used for academic quality filtering

op可选Operation type. Values: `metadata` (metadata query, default), `citations` (cited-by list), `references` (reference list), `citation-count` (citation count), `reference-count` (reference count), `author` (works by author), `editor` (works by editor), `venue-citation-count` (journal citation count), `citation` (single citation relationship, requires OCI)

open_access可选Whether open access. Valid values: true, false

sort可选RAMOSE sort expression. Format: `field:order`, e.g., `creation:desc` (descending by creation time).

type可选1. Document type filter. Values: `journal-article` (journal paper), `book` (book), `proceedings-article` (conference paper), `dataset` (dataset), `book-chapter` (book chapter), `posted-content` (preprint), `report` (report), etc. Maps to Crossref `filter=type:{value}`. 2. Publication type, comma-separated multi-value (no spaces). Valid values (13): `JournalArticle`, `Conference`, `Review`, `CaseReport`, `ClinicalTrial`, `Dataset`, `Editorial`, `LettersAndComments`, `MetaAnalysis`, `News`, `Study`, `Book`, `BookSection`. Maps to `publicationTypes` parameter.

venue可选Journal/conference name, comma-separated multi-value. Must match S2 database exactly. Common values: `NeurIPS`, `ICML`, `ICLR`, `CVPR`, `Nature`, `Science`, `Cell`, `Lancet`.

year_from可选Publication date lower bound. Format `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`.

year_to可选Publication date upper bound. Format `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`.

academic.dataset科研数据集4 参数+

academic.preprint预印本论文9 参数+

academic.search跨学科论文搜索9 参数+

### agriculture

agriculture.faoFAO全球农业统计5 参数+

### business

business.company企业工商信息2 参数+

business.jobs招聘信息4 参数+

business.people企业联系人5 参数+

business.trade国际贸易数据5 参数+

### code

code.doc开发文档查询1 参数+

code.snippet代码片段搜索3 参数+

### energy

energy.electricity电力市场数据5 参数+

energy.production能源生产消费统计5 参数+

### environment

environment.aqi空气质量指数2 参数+

### film

film.torrentBT种子搜索0 参数+

### finance

finance.calendar财报/经济日历3 参数+

finance.fundamental财务报表/估值/评级4 参数+

finance.macro宏观经济指标2 参数+

finance.news财经新闻/公告/研报5 参数+

finance.quote实时/历史行情报价4 参数+

finance.screen股票筛选3 参数+

### gaming

gaming.esports电竞数据查询8 参数+

gaming.storeSteam游戏商店0 参数+

### general

general.general通用搜索0 参数+

### health

health.drug药品信息查询,query根据type去填写1 参数−

参数必填说明

type必填Query type. Values: `name` (drug name search), `ndc` (NDC code lookup), `upc` (UPC barcode lookup)

health.stats公共卫生统计0 参数+

health.trial临床试验查询0 参数+

### ip

ip.global全球专利检索5 参数−

参数必填说明

applicant可选Huawei / Huawei Technologies (applicant/organization name filter)

date_start可选2020 / 20200101 (publication/application date start)

ipc可选H01L / G06N (IPC/CPC classification filter)

keyword可选solar cell / AI (search keyword)

type可选GlobalPatent (global patents)

### legal

legal.case法院判决书6 参数−

参数必填说明

case_id可选CanLII case identifier. Format: 4-digit year + lowercase court code + case number, e.g. `2008scc9` (Dunsmuir v. New Brunswick), `2014onca925`, `1998canlii793`. When provided, the plugin performs an exact case metadata lookup. When empty, falls back to database browsing mode. Do NOT pass natural language queries or keywords — only valid CanLII caseIds.

database_id可选Target court database code. Examples: `csc-scc` (Supreme Court of Canada), `onca` (Ontario Court of Appeal), `bcca` (BC Court of Appeal), `fca` (Federal Court of Appeal), `qcca` (Quebec Court of Appeal). When empty, uses configured default database list.

doc_type可选Document type to search. Values: `o` (opinions, default), `r` (RECAP archives), `rd` (RECAP documents), `d` (dockets), `p` (people/judges), `oa` (oral arguments). When empty, defaults to opinions. Alternatively, ECHR document type filter. Values: `JUDGMENTS` (judgments), `DECISIONS` (decisions), `COMMUNICATEDCASES` (communicated cases). When empty, searches all three types.

language可选API output language. Values: `en` (English, default), `fr` (French). Affects returned case title and URL language version.

respondent可选Respondent country code in ISO 3166-1 alpha-3 format. Examples: `TUR` (Turkey), `FRA` (France), `RUS` (Russia), `GBR` (UK), `DEU` (Germany), `ITA` (Italy), `UKR` (Ukraine). When empty, no country filter.

service可选Target search service, takes priority over tag-based routing. Values: `case` or `case-search` (semantic case search), `casekw` or `case-keyword` (keyword case search), `law` or `law-search` (statute search). When empty, auto-routed by tags, defaulting to statute search.

legal.legislation立法进程追踪1 参数−

参数必填说明

congress可选Specify which US Congress session to query. Integer value, e.g., 118 for the 118th Congress (2023-2024), 119 for the 119th (2025-2026). When empty, auto-calculates current session. Required when querying bills from previous sessions.

legal.statute法律法规条文8 参数−

参数必填说明

agency可选Publishing agency slug identifier. Common values: `environmental-protection-agency` (EPA), `securities-and-exchange-commission` (SEC), `food-and-drug-administration` (FDA), `federal-communications-commission` (FCC), `department-of-energy` (DOE), `department-of-labor` (DOL). When empty, searches all agencies.

collection可选Document collection code to restrict search. Common values: `FR` (Federal Register), `CFR` (Code of Federal Regulations), `USCODE` (United States Code), `BILLS` (Congressional Bills), `PLAW` (Public and Private Laws), `USCOURTS` (Court Opinions), `CREC` (Congressional Record), `STATUTE` (Statutes at Large). When empty, searches all collections.

date_from可选1. Regulation effective date filter, format `YYYY-MM-DD`. Only returns provisions effective on or after this date. Example: `2024-01-01` limits to content effective from 2024 onward. When empty, no date filter. 2. Publication date lower bound, format `YYYY-MM-DD`. Only returns documents published on or after this date. When empty, no lower bound.

date_to可选Publication date upper bound, format `YYYY-MM-DD`. Only returns documents published on or before this date. Use with `date_from` to define a date range. When empty, no upper bound.

doc_type可选1. Document type filter, using EUR-Lex resource-type codes. Values: `REG` (Regulation), `DIR` (Directive), `DEC` (Decision). When empty, searches all types. 2. UK legislation type code, takes priority over type extraction in tags. Values: `ukpga` (UK Public General Acts), `uksi` (UK Statutory Instruments), `asp` (Acts of the Scottish Parliament), `anaw` (Acts of the National Assembly for Wales), `nia` (Northern Ireland Acts), `primary` (all primary legislation), `secondary` (all secondary legislation), `all` (all types). When empty, no type filter. 3. Federal Register document type filter. Values: `RULE` (final rules), `PRORULE` (proposed rules), `NOTICE` (notices), `PRESDOCU` (presidential documents, including executive orders). When empty, searches all types.

historical可选Whether to include historical version documents. Value: `true` or `false`, default `false`. When `true`, returns historical revision versions of documents.

language可选Result language, using ISO 639-1 codes. Values: `en` (English, default), `fr` (French), `de` (German), `it` (Italian), `es` (Spanish) and other EU official languages. Affects the title and abstract language of returned documents.

title可选CFR Title number, to restrict search scope to a specific federal regulation title. Examples: `40` (Environmental Protection), `21` (Food and Drugs), `48` (Federal Acquisition Regulations), `49` (Transportation), `6` (Domestic Security). When empty, searches all Titles.

### resource

resource.image图片搜索0 参数+

### security

security.intel威胁情报查询1 参数+

security.noise背景噪音判断1 参数+

security.scan多引擎恶意扫描1 参数+

security.vuln漏洞数据库2 参数−

参数必填说明

type必填Query intent: CVE lookup by ID / commit hash lookup / package vulnerability query， e.g "cve" / "commit" / "package"

value必填Value matching the type: CVE ID / 40-char hex / `ecosystem:name@version`. Comma-separated for batch, auto-dedup e.g. {"type": "cve", "value": "CVE-2021-44228"} {"type": "package", "value": "PyPI:jinja2@2.4.1"} {"type": "commit", "value": "6879efc2c1596d11a6a6ad296f80063b558d5e0f"}

### social_media

social_media.social_media社交媒体信息搜索获取3 参数−

参数必填说明

keyword可选AI large models / Python developer / Musk (Search keywords take precedence over query fields)

region可选Beijing / Shanghai / Guangdong (Region filtering only works when type=weibo_hot)

type可选type：weibo / weibo_hot / zhihu / zhihu_hot / x_top / x_latest / x_media / x_people / x_lists / reddit_post / reddit_community / reddit_comment / reddit_media / reddit_people / linkedin_people / linkedin_jobs / linkedin_company / linkedin_posts / wechatmp（Target platforms and search patterns）

### travel

travel.flight机票搜索12 参数+

travel.flight_status航班动态查询11 参数+

## MCP Server 安装

AnySearch MCP Server 原生支持 Streamable HTTP 传输协议（MCP spec 2025-03-26）。SSE 和 stdio 客户端可通过代理连接。根据您使用的客户端选择对应的安装方式。

## 传输方式

传输协议原生支持适用客户端

Streamable HTTP✅ 是OpenCode、Claude Desktop (2025.6+)、Web 客户端

SSE需代理Cursor、Windsurf

stdio需代理Claude Desktop (旧版)、VS Code Copilot、Cline

## Streamable HTTP（推荐）

适用于支持 Streamable HTTP 传输协议的客户端，配置最简单。

json复制

{

  "mcp": {

​    "anysearch": {

​      "type": "remote",

​      "url": "https://api.anysearch.com/mcp",

​      "headers": {

​        "Authorization": "Bearer ${ANYSEARCH_API_KEY}"

​      }

​    }

  }

}

json复制

{

  "mcpServers": {

​    "anysearch": {

​      "type": "streamable-http",

​      "url": "https://api.anysearch.com/mcp",

​      "headers": {

​        "Authorization": "Bearer ${ANYSEARCH_API_KEY}"

​      }

​    }

  }

}

提示：如果不使用 API Key，可省略 headers 部分。服务器将自动使用匿名访问模式。

## Stdio 代理

适用于仅支持 stdio 传输的客户端。需通过代理工具桥接，推荐使用 mcp-remote。

json复制

{

  "mcpServers": {

​    "anysearch": {

​      "command": "npx",

​      "args": [

​        "-y",

​        "mcp-remote",

​        "https://api.anysearch.com/mcp",

​        "--header",

​        "Authorization: Bearer ${ANYSEARCH_API_KEY}"

​      ]

​    }

  }

}

json复制

{

  "servers": {

​    "anysearch": {

​      "type": "stdio",

​      "command": "npx",

​      "args": [

​        "-y",

​        "mcp-remote",

​        "https://api.anysearch.com/mcp",

​        "--header",

​        "Authorization: Bearer ${ANYSEARCH_API_KEY}"

​      ]

​    }

  }

}

json复制

{

  "mcpServers": {

​    "anysearch": {

​      "command": "npx",

​      "args": [

​        "-y",

​        "mcp-remote",

​        "https://api.anysearch.com/mcp",

​        "--header",

​        "Authorization: Bearer ${ANYSEARCH_API_KEY}"

​      ]

​    }

  }

}

也可使用 supergateway 作为替代方案：

json复制

{

  "mcpServers": {

​    "anysearch": {

​      "command": "npx",

​      "args": [

​        "-y",

​        "supergateway",

​        "--streamableHttp",

​        "https://api.anysearch.com/mcp",

​        "--oauth2Bearer",

​        "${ANYSEARCH_API_KEY}"

​      ]

​    }

  }

}

提示：如果不使用 API Key，省略 "--header" 和 "Authorization: Bearer ..." 参数（mcp-remote），或省略 "--oauth2Bearer" 和 Key 参数（supergateway）。

## SSE 代理

适用于仅支持 SSE 传输的客户端（Cursor、Windsurf）。需先启动本地 SSE 代理服务器。

bash复制

npx -y supergateway \

  --streamableHttp https://api.anysearch.com/mcp \

  --outputTransport sse \

  --port 8000 \

  --oauth2Bearer <your_api_key>

json复制

{

  "mcpServers": {

​    "anysearch": {

​      "type": "sse",

​      "url": "http://localhost:8000/sse"

​    }

  }

}

json复制

{

  "mcpServers": {

​    "anysearch": {

​      "serverUrl": "http://localhost:8000/sse"

​    }

  }

}

注意：SSE 代理需在客户端运行期间保持开启。建议将其作为后台服务运行。不使用 API Key 时可省略 --oauth2Bearer 参数。

## 客户端速查表

客户端传输协议配置文件路径需要代理代理工具

OpenCodeStreamable HTTPopencode.json否—

Claude Desktop (2025.6+)Streamable HTTPclaude_desktop_config.json否—

Claude Desktop (旧版)stdioclaude_desktop_config.json是mcp-remote

CursorSSE.cursor/mcp.json是supergateway

VS Code Copilotstdio.vscode/mcp.json是mcp-remote

WindsurfSSEmcp_config.json是supergateway

ClinestdioVS Code 设置是mcp-remote

## Skill 安装

AnySearch Skill 是面向 AI Agent 平台的统一搜索技能包。下载后放入您的 Agent 技能目录即可使用。

## 下载安装

从 GitHub 下载 Skill 压缩包，解压后移动到对应平台的技能目录。

Agent PlatformSkill Directory

Claude Code~/.claude/skills/anysearch

OpenCode~/.opencode/skills/anysearch

Cursor / Windsurf<project>/.skills/anysearch

OpenClaw~/.openclaw/skills/anysearch

Other platforms<agent_skill_dir>/anysearch

提示：OpenClaw 用户可直接通过命令安装：openclaw skills install anysearch，无需手动下载。

bash复制

\# 下载

curl -L -o anysearch-skill.zip https://github.com/anysearch-ai/anysearch-skill/archive/refs/heads/main.zip



\# 解压

unzip anysearch-skill.zip



\# 移动到技能目录（以 OpenCode 为例，请根据实际平台调整路径）

mv anysearch-skill ~/.opencode/skills/anysearch

## API Key 配置

API Key 为可选项，但强烈建议配置。未配置时仍可通过匿名模式使用所有搜索功能，但速率限制和配额较低。

bash复制

cp .env.example .env

\# 编辑 .env，设置：ANYSEARCH_API_KEY=your_api_key_here

bash复制

\# Linux / macOS

export ANYSEARCH_API_KEY=your_api_key_here



\# Windows CMD

set ANYSEARCH_API_KEY=your_api_key_here



\# Windows PowerShell

$env:ANYSEARCH_API_KEY="your_api_key_here"

提示：API Key 可在 anysearch.com/console/api-keys 免费创建。优先级：CLI 参数 > .env 文件 > 环境变量 > 匿名访问。

## 验证安装

安装完成后，检测可用运行时并运行入口测试确认一切正常。

bash复制

\# 按优先级依次检查（Python > Node.js > Shell）

python --version   # 需要 >= 3.6，依赖 requests 库

node --version     # 需要 >= 12，无外部依赖

bash复制

\# Python

python <skill_dir>/scripts/anysearch_cli.py doc



\# Node.js

node <skill_dir>/scripts/anysearch_cli.js doc



\# PowerShell (Windows)

powershell -ExecutionPolicy Bypass -File <skill_dir>/scripts/anysearch_cli.ps1 doc



\# Bash (Linux/macOS)

bash <skill_dir>/scripts/anysearch_cli.sh doc

bash复制

python <skill_dir>/scripts/anysearch_cli.py search "hello world" --max_results 1

提示：入口测试返回正常 JSON 输出即表示安装成功。<skill_dir> 请替换为实际的 Skill 安装路径。