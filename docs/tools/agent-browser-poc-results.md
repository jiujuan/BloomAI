# Agent Browser POC 结果

## 执行信息

- 日期：2026-08-04
- 命令：`npm run verify:web-tools-browser`
- Fixture：`src/server/tools/web/__fixtures__/agent-browser-page.html`
- SDK：`@mastra/agent-browser@0.4.1`
- 调用方式：`new AgentBrowser()`、`goto()`、`getManagerForThread()`、manager `page.content()`、`screenshot()`、`close()`
- 浏览器：受控本地 Chromium-compatible executable，headless
- 网络边界：fixture 仅监听 `127.0.0.1`；POC page route 阻断 `/blocked-resource.png`

## 结果

| 检查项 | 结果 |
|---|---|
| AgentBrowser 公共 API | 通过，`agentBrowserApiUsed: true` |
| manager/page DOM 读取 | 通过，`managerReadHydrated: true` |
| JavaScript hydration | 通过，`hydrated: true` |
| AgentBrowser PNG screenshot | 通过，1024 x 768，13,052 bytes |
| 不安全子资源拦截 | 通过，`blockedRequests: 1` |
| AbortSignal 映射 | 通过，`WEB_BROWSER_ABORTED` |
| abort 后 context 清理 | 通过，`contextsAfterAbort: 0` |
| AgentBrowser/provider close | 通过，`browserClosed: true` |

截图 artifact：

```text
<BLOOMAI_B2_ARTIFACT_DIR>/tool-artifacts/web-screenshot/release-b2-poc-agent-browser/screenshot.png
```

缺失浏览器时，探针将错误映射为 `WEB_BROWSER_UNAVAILABLE` 并以非零退出码结束，不会静默退回成功结果。该 POC 证明 `@mastra/agent-browser` 的真实公共 API 能执行页面 hydration 和 screenshot；既有 provider 的取消与 context 生命周期回归也保持通过。它不证明 C 类执行工具已具备 OS 级隔离；执行工具仍保持 unavailable。
