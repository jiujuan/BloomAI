# Agent Browser POC 结果

## 执行信息

- 日期：2026-08-04
- 命令：`npm run verify:web-tools-browser`
- Fixture：`src/server/tools/web/__fixtures__/agent-browser-page.html`
- 浏览器：系统 Chrome/Edge channel，headless

## 结果

| 检查项 | 结果 |
|---|---|
| JavaScript hydration | 通过，`hydrated: true` |
| PNG screenshot | 通过，1024 x 768，13,052 bytes |
| 不安全子资源拦截 | 通过，`blockedRequests: 1` |
| AbortSignal 映射 | 通过，`WEB_BROWSER_ABORTED` |
| abort 后 context 清理 | 通过，`contextsAfterAbort: 0` |
| browser close | 通过，`browserClosed: true` |

artifact：

```text
C:\Users\xing\AppData\Local\Temp\bloomai-release-b2-evidence\tool-artifacts\web-screenshot\release-b2-poc\screenshot.png
```

该 POC 证明浏览器 provider 能执行真实页面 hydration 和 screenshot，同时在主请求/子资源策略、取消和 context 生命周期上遵守 B2 的受控边界。它不证明 C 类执行工具已具备 OS 级隔离；执行工具仍保持 unavailable。
