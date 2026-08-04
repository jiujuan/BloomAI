# T5 AgentBrowser Adapter 验收证据

## 范围

- `AgentBrowserProvider` 仅作为内部 `WebPageProvider` / `WebScreenshotProvider` 适配层使用。
- 每次调用创建独立 Browser Context 和 Page；释放时关闭 Page/Context。
- 浏览器实例可复用，空闲超时关闭，服务收到 `SIGINT` / `SIGTERM` 时关闭默认 Router 的 Provider。
- 导航、最终 URL、子资源请求均复用 URL Policy 和 AbortSignal。
- Session pool 限制并发、支持排队超时、排队取消和 shutdown。
- 诊断只记录 provider、结果、耗时、阻断计数或稳定错误码，不复制 HTML、Cookie、完整 query 或底层错误文本。

## 自动化测试

命令：

```text
npm test -- src/server/tools/web/agent-browser-provider.test.ts src/server/tools/web/browser-session-pool.test.ts src/server/tools/web/config.test.ts src/server/tools/web/provider-router.test.ts src/server/tools/web/browser-route-guard.test.ts
npm run typecheck
git diff --check
```

结果：

```text
5 test files passed
21 tests passed
npm run typecheck passed
git diff --check passed
```

覆盖：

- fake Browser/Context/Page 的渲染 HTML、HTTP 状态、截图 bytes/尺寸和资源释放。
- 导航失败映射为 `WEB_BROWSER_NAVIGATION_FAILED`。
- 浏览器缺失映射为 `WEB_BROWSER_UNAVAILABLE`，诊断不泄露 executable path。
- AbortSignal 中止导航后关闭 Page/Context，且不额外启动 Browser。
- Session pool 最大并发、排队超时、排队取消、空闲回调和 shutdown。
- disabled 配置不会启动 Browser。

## 已知限制

真实 Chromium 启动与 Electron 安装包 smoke 由 T12 统一发布门禁执行；T5 单元测试不依赖本机浏览器或公网。
