# T6 Web Screenshot 验收证据

## 实现范围

- `web_screenshot` 保持原 Tool ID，不接受调用者提供的任意 `outputPath`。
- 截图由内部 `AgentBrowserProvider` 提供，经过统一 URL Policy、AbortSignal 和浏览器 request guard。
- PNG/JPEG、fullPage、viewport、最大高度、总像素和 artifact 字节数均受限。
- artifact 写入 `tool-artifacts/web-screenshot/<runId>/`，使用临时文件加 rename；取消或失败时清理临时文件。
- 历史截图 run 按 retention count pruning，审计输出只保留路径和元数据，不写入图片内容。

## 自动化测试

命令：

```text
npm test -- src/server/tools/web-screenshot.test.ts src/server/tools/web/agent-browser-provider.test.ts
npm test -- src/server/tools/web/provider-router.test.ts src/server/tools/web/browser-session-pool.test.ts src/server/tools/web/browser-route-guard.test.ts src/server/tools/web/config.test.ts src/server/tools/availability.test.ts
npm run typecheck
git diff --check
```

结果：

```text
2 test files passed
13 tests passed

5 test files passed
20 tests passed

npm run typecheck passed
git diff --check passed
```

覆盖内容：

- PNG artifact 路径、文件内容和受控 data directory。
- JPEG artifact、quality、fullPage 和 viewport 参数传递。
- viewport/像素/文件字节限制返回 `WEB_SCREENSHOT_LIMIT_EXCEEDED`。
- 取消前不启动 provider，artifact 目录无孤立临时文件。
- artifact 原子替换、临时文件清理和历史 run pruning。
- AgentBrowser Page/Context 释放、浏览器错误映射和禁用配置。

## 真实本地 fixture 验收

命令：

```text
BLOOMAI_WEB_BROWSER_INTEGRATION=1 npm run verify:web-tools-browser
```

结果摘要：

```json
{
  "agentBrowserApiUsed": true,
  "hydrated": true,
  "screenshotSource": "agent_browser",
  "screenshot": {
    "width": 1024,
    "height": 768,
    "bytes": 13052
  },
  "blockedRequests": 1,
  "abortCode": "WEB_BROWSER_ABORTED",
  "contextsAfterAbort": 0,
  "browserClosed": true
}
```

截图 artifact 位于受控的临时 evidence 目录下，路径形态为：

```text
<temporary-evidence-dir>/tool-artifacts/web-screenshot/release-b2-poc-agent-browser/screenshot.png
```

Electron 安装包 smoke 和最终发布回滚证据由 T12 统一完成。
