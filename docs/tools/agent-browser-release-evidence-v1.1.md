# AgentBrowser Web Tools 发布验收证据

> 证据版本：v1.1
> 日期：2026-08-04
> 分支：`feat/tools-agent-browser-web-impl`
> 结论：功能、安全、性能、Electron 目录包、portable 包及 Windows NSIS 安装器 smoke 全部通过。

## 1. 环境与依赖

| 项目 | 结果 |
|---|---|
| OS | Windows 10.0.26200 |
| Node | 22.16.0 或更高，满足 `package.json` engines |
| Electron | 37.10.3 |
| electron-builder | 24.13.3 |
| `@mastra/core` | 1.51.0 |
| `@mastra/agent-browser` | 0.4.1，已锁定 |
| 浏览器 | 受控本地 Chromium-compatible Chrome/Edge，headless |
| 浏览器默认开关 | `WEB_BROWSER_ENABLED=false` |
| Browser SERP 默认开关 | `WEB_SEARCH_BROWSER_FALLBACK=false` |
| 浏览器上下文上限 | 2 |

AgentBrowser POC 使用已验证的公共 API：`new AgentBrowser()`、`ensureReady()`、`goto()`、`getManagerForThread()`、manager page `content()`、`screenshot()` 和 `close()`。未向 Chat Agent 注册原始 `browser_*` 工具。

## 2. 自动化验证

以下命令均在仓库根目录执行并通过：

```text
npm run typecheck
npm test -- --silent
npm run build
npm run verify:web-tools-browser
npm run baseline:web-tools-browser
git diff --check
```

`verify:web-tools-browser` 的关键结果：

| 检查 | 结果 |
|---|---|
| JS hydration | `true` |
| AgentBrowser screenshot | PNG，`1024x768`，`13052` bytes |
| 子资源阻断 | `blockedRequests=1` |
| abort 错误 | `WEB_BROWSER_ABORTED` |
| abort 后 context | `0` |
| Browser close | `true` |
| 静态 `web_fetch` / `web_extract` | `static_http`，未启动浏览器 |
| 渲染 `web_fetch` / `web_extract` | `agent_browser`，取得 hydrated 内容 |
| Browser disabled screenshot | `WEB_BROWSER_DISABLED` |
| 回滚后的 fetch/extract | 继续使用 `static_http` |
| 峰值 context | `1`，上限 `2` |

`docs/tools/agent-browser-baseline-v1.1.json` 的本地 fixture 基线：

| 路径 | 成功数 | P50 | P95 |
|---|---:|---:|---:|
| static fetch | 5/5 | 13 ms | 20 ms |
| browser fetch | 5/5 | 490 ms | 826 ms |
| browser extract | 5/5 | 599 ms | 691 ms |
| screenshot | 3/3 | 661 ms | 667 ms |

截图 artifact 为 `13052` bytes，峰值 context 为 `2/2`，不安全 URL probe 返回 `WEB_URL_UNSAFE`。

## 3. Electron 打包证据

目录包命令通过：

```text
npx electron-builder --dir --config.win.signAndEditExecutable=false
```

已确认存在：

```text
dist/win-unpacked/BloomAI.exe
dist/win-unpacked/resources/app.asar
dist/win-unpacked/resources/app.asar.unpacked/node_modules/@mastra/agent-browser
```

便携式 Windows 包命令通过：

```text
npx electron-builder --win portable --config.win.signAndEditExecutable=false
```

已生成：

```text
dist/BloomAI 0.1.0.exe
```

该包证明 Electron 资源和 AgentBrowser 依赖已进入构建产物；portable 包与 NSIS 安装器分别完成了对应形态的发布验证。

### NSIS 安装器 smoke

NSIS 安装器及安装后 fixture smoke 已完成。为避免签名工具链对本地验收的干扰，使用以下命令生成未签名验收包：

```text
npx electron-builder --win nsis --config.directories.output=release-t12 --config.win.signAndEditExecutable=false
```

验收结果：

- 静默安装退出码为 `0`；
- 安装后的 `BloomAI.exe` 启动成功，`GET /health` 返回 `200`；
- 安装后数据库完成 `28` 条迁移，并包含 `skill_runs_v2`；
- 安装包内 Browser Provider 资源可加载，未出现 `app.asar` 路径或迁移路径错误；
- Browser Provider 默认仍为关闭，回滚仍通过配置级开关完成。

## 4. 回滚演练

将 `WEB_BROWSER_ENABLED=false` 后：

1. `web_fetch` 和 `web_extract` 继续返回 `static_http`；
2. 不再启动 Browser Provider；
3. `web_screenshot` 返回 `WEB_BROWSER_DISABLED`，不会伪造成功 artifact；
4. `WEB_SEARCH_BROWSER_FALLBACK=false` 保持 Tavily -> DuckDuckGo 主路径，不启用 SERP 浏览器回退。

不需要数据库回滚或修改对外四个 Tool ID。

## 5. 任务状态

- T1-T11 的实现和对应提交已完成；T1/T6 的开发环境、目录包、portable 包和 NSIS 安装器证据通过。
- T12 的功能、安全、取消、资源、回滚、性能和 NSIS 安装器证据已完成。
- 没有将 P0/P1 SSRF、取消、任意 artifact 路径或资源泄漏问题标记为“后续处理后仍发布”。
