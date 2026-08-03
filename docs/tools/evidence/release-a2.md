# Release A2 验收证据

## 范围

Release A2 覆盖 PathPolicy、UrlPolicy/SSRF、流式资源上限、执行取消传播，以及文件、文档、网页、视觉和图片生成工具的资源边界。

## 实现证据

- `src/server/tools/utils/path-policy.ts`
  - 读取目标使用 `realpath()`。
  - 写入目标 canonicalize 已存在父目录。
  - 按路径 segment 校验 approved roots，拒绝 `..` 越界、根目录前缀相似路径、设备路径、NUL 和符号链接逃逸。
- `src/server/tools/utils/url-policy.ts`
  - 仅允许 HTTP(S)。
  - 拒绝 credentials、localhost、私网、loopback、link-local、multicast、unspecified 和 IPv4-mapped private IPv6。
  - redirect 每一跳重新做 URL 与 DNS 校验。
- `src/server/tools/utils/binary-limit.ts`
  - 图片默认上限为 10 MiB。
  - response body 通过 reader 流式读取，超限后截断并调用 `reader.cancel()`。
  - 远程图片校验最终 URL 和 `image/png`、`image/jpeg`、`image/gif`、`image/webp` MIME。
- `src/server/tools/utils/html.ts`、`src/server/tools/utils/render.ts`
  - HTML 下载和 Playwright 子请求使用共享 URL 策略。
  - 浏览器请求通过 `page.route('**/*')` 阻断不安全子请求，并响应 execution abort。
- `vision` 和 `image_gen`
  - 本地图片/保存目标使用统一 PathPolicy。
  - 视觉图片与生成图片下载受 MIME、10 MiB 和 AbortSignal 约束。

## 自动化测试证据

执行命令：

```text
npm test -- src/server/tools/utils/binary-limit.test.ts src/server/tools/vision.test.ts src/server/tools/utils/path-policy.test.ts src/server/tools/utils/url-policy.test.ts src/server/tools/utils/stream-limit.test.ts src/server/tools/execute-tool.test.ts src/server/llm/media/image.test.ts src/server/llm/media/adapters/image-adapters.test.ts
```

结果：

```text
8 test files passed
38 tests passed
```

覆盖的验收场景：

- `../` 越界、根目录前缀相似路径和符号链接逃逸拒绝。
- 远程图片 redirect 重新校验，非图片 MIME 拒绝。
- response 超过上限时流被取消，未完整读入内存。
- 本地图片超出 10 MiB 时在读取前拒绝。
- vision 本地路径只能访问 approved root，远程图片先经过共享下载策略。
- executeTool timeout 会 abort executor，并将运行记录为 `timeout`。
- OpenAI、Agnes、OpenAI-compatible、Ollama 图片适配器的既有请求形状保持通过。

## 构建与静态检查证据

```text
npm run typecheck
passed

npm run build
passed

git diff --check
passed
```

## 已知边界

- `web_screenshot`、`ocr`、`image_edit` 仍由 Availability 层明确标记为 unavailable；真实截图和 OCR/image-edit 的交付属于后续 B2。
- 图片分辨率解析未在 A2 引入第三方图像解码依赖；当前已落实 MIME 和 10 MiB 字节边界，分辨率治理在 B2 媒体能力验收中继续处理。
