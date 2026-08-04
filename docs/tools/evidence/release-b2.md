# Release B2 验收证据

## 验收日期

2026-08-04

## 范围

Release B2 完成已承诺 Web 能力的真实可用性治理和受控浏览器实现：

- `web_fetch`、`web_extract` 通过 Provider Router 使用静态 HTTP 优先、浏览器按需回退的策略。
- `web_screenshot` 使用受控浏览器生成 PNG/JPEG artifact。
- 浏览器默认关闭；未配置或未启动浏览器时保持 unavailable 或保留静态结果。
- 浏览器 context/page 使用并发上限、独立生命周期和取消清理。
- 主文档导航和子资源请求都经过 URL policy；不安全请求由 route guard 拦截。
- screenshot artifact 只能写入 `DATA_DIR/tool-artifacts/web-screenshot/<runId>/`，并受 viewport、页面高度、像素数、超时和字节数上限约束。
- `ocr`、`image_edit` 仍保持 dependency missing，不以占位结果冒充成功能力。
- `node_runner`、`python_runner`、`shell` 仍保持默认 disabled/unavailable，等待 Release C 的执行隔离验收。

## 实现证据

- `src/server/tools/web/provider-router.ts`
  - `render: false` 强制静态 provider。
  - `render: true` 优先浏览器，失败时返回静态结果并保留 provider attempt 诊断。
  - 自动模式先使用静态结果；正文过薄时才尝试浏览器增强。
- `src/server/tools/web/agent-browser-provider.ts`
  - 复用受控系统浏览器，限制 context 并发。
  - 页面导航、重定向和子资源请求均执行 URL 校验。
  - AbortSignal 会关闭 page，context 在释放时关闭。
  - 截图执行 viewport、页面高度、总像素和 artifact 大小限制。
- `src/server/tools/web/browser-session-pool.ts`
  - 限制并发 session。
  - 取消排队请求不会占用 slot。
  - provider close 会清理活动 context 并拒绝排队请求。
- `src/server/tools/web/screenshot-artifacts.ts`
  - 忽略 caller supplied output path。
  - 使用固定 artifact 目录和安全 run id。
  - 限制 artifact 大小并返回实际路径、类型和字节数。
- `src/server/tools/availability.ts`
  - 浏览器开关、系统浏览器 channel 探测和 placeholder 状态统一映射为 availability。
- `src/server/tools/web-screenshot.ts`
  - 仅通过受控 provider 写入 screenshot artifact。

## 自动化测试证据

### B2 定向测试

执行命令：

```text
npm test -- src/server/tools/web-extract.test.ts src/server/tools/web-screenshot.test.ts src/server/tools/web/config.test.ts src/server/tools/web/browser-route-guard.test.ts src/server/tools/web/browser-session-pool.test.ts src/server/tools/web/provider-router.test.ts src/server/tools/web/agent-browser-poc.test.ts src/server/tools/availability.test.ts src/server/http/routes/tools.test.ts --reporter=dot
```

结果：

```text
8 test files passed
1 test file skipped
23 tests passed
1 test skipped
exit code 0
```

覆盖的验收场景：

- 静态页面正文足够时不启动浏览器。
- 页面正文过薄时按策略回退到浏览器；浏览器失败时保留静态结果。
- `render: false` 和 `render: true` 遵守显式 provider 选择。
- 主请求和不安全子资源被 route guard 拦截。
- 排队取消、并发上限和 provider close 清理行为正确。
- screenshot artifact 受目录、大小和 caller path 约束。
- placeholder 工具继续 unavailable，Agent 不暴露不可用工具。

### 真实浏览器 POC

执行命令：

```text
npm run verify:web-tools-browser
```

结果：

```json
{
  "hydrated": true,
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

artifact：

```text
C:\Users\xing\AppData\Local\Temp\bloomai-release-b2-evidence\tool-artifacts\web-screenshot\release-b2-poc\screenshot.png
```

### 工程门禁

```text
npm run typecheck
passed

npm run build
passed

npm test -- --reporter=verbose
exit code 0

git diff --check
passed
```

全量测试包含既有数据库和集成测试，单线程执行耗时约 9 分 18 秒；本次命令最终以退出码 0 完成。

## 验收结论

Release B2 验收通过。已承诺的浏览器截图能力具备真实 provider、受控 artifact、请求拦截、并发边界和取消清理证据；页面抓取具备静态优先和浏览器回退策略。OCR 与 image edit 没有虚报为可用，执行类工具继续等待 Release C 隔离门槛。
