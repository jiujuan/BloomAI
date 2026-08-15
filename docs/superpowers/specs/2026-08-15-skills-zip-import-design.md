# 导入 Skills ZIP 设计说明

**日期：** 2026-08-15  
**状态：** 已确认，等待规格审阅  
**范围：** Skills Center → 导入 Skill 页面，以及 Electron 选择 ZIP 文件 IPC。

## 目标

将当前“npx skills 产物”导入入口替换为“导入skills zip”。用户可以通过原生文件选择器选择一个本机 `.zip` 文件，页面显示 ZIP 的绝对路径；点击“开始扫描”后，系统安全解析压缩包、发现其中的 `SKILL.md` 目录，并复用既有 Import Review 与安装流程导入所有发现的 Skills。

## 用户体验

### Tab 与文案

- 保持三个导入方式：`GitHub Archive`、`本地目录`、`导入skills zip`。
- 移除 UI 中的“npx skills 产物”入口和相关文案。
- 页面说明更新为支持本地目录、GitHub Archive 和 Skills ZIP。

### “导入skills zip”表单

- 表单布局与“本地目录”一致：一个选择区域、一个路径输入框、一个可选的 Skill 子目录字段，以及“开始扫描”按钮。
- 选择区域的主操作为“选择 ZIP 文件”，调用 Electron 原生文件选择器。
- 原生对话框只允许选择单个文件，并使用 `.zip` 文件过滤器。
- 选择成功后，将绝对路径显示在选择区域和“ZIP 文件路径”输入框；用户仍可手动修改路径。
- 仅接受以 `.zip` 结尾的路径；未选择或扩展名不正确时，在扫描前显示中文校验提示。
- “Skill 子目录（可选）”使用 ZIP 内的相对路径，例如 `skills/article-illustrator`。路径不能通过 `..` 越出压缩包根目录。

### 扫描与安装

- 点击“开始扫描”构造 `PackageSource`：
  ```ts
  { kind: 'zip', zipPath, subdirectory? }
  ```
- 调用现有 `inspectPackage` API，继续沿用现有的 ZIP 安全校验、内容预算、Zip Slip 防护、文件快照、清单解析、递归 Skill 发现和 Import Review。
- 已批准的 review 继续通过现有 `installPackage` API 安装全部扫描结果；不新增上传接口、服务端文件复制逻辑或自动执行任何 `npx` 命令。

## 技术设计

### Renderer

修改 `PackageInstallDialog`：

- 导入来源类型仍保留 `zip`，但其成为第三个可见 Tab。
- Tab 的 label 为“导入skills zip”，描述为“选择 ZIP 压缩包并扫描其中的 Skills”。
- ZIP 表单使用 `artifactPath`（或等价的专用 ZIP 路径字段）生成 `kind: 'zip'` source，保持 API 契约不变。
- 新增选择 ZIP 文件、拖入 ZIP 文件路径和对应错误状态处理；拖入非 ZIP 文件会提示改用 ZIP 文件。
- 切换来源、重新选择文件或手动修改路径时，清除旧的扫描与 review 状态，保持现有行为一致。

### Electron IPC 与 preload

新增受限 IPC：

- 常量：`dialog:select-zip-file`。
- Main handler：调用 `dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'ZIP files', extensions: ['zip'] }] })`。
- handler 只返回 `{ canceled: boolean, path?: string }`，只暴露第一项选择结果；取消时不返回路径。
- preload 暴露 `window.bloomai.selectZipFile()`。
- Renderer `platform` 增加 `selectZipFile()`，非 Electron 运行时返回 `{ canceled: true }`，与 `selectDirectory()` 的降级方式一致。

### 后端

无需新的 ZIP 解压或安装实现。现有 `PackageInstaller` 与包读取层已经支持：

- `PackageSource.kind === 'zip'`；
- ZIP 解压和安全路径策略；
- 发现一个压缩包中的多个 Skill 根目录；
- source fingerprint 绑定与安装前重验。

本变更仅将受控的本机 ZIP 路径通过现有 source API 传入，后端边界继续重复验证该路径和 ZIP 内容。

## 回归测试

1. **主进程 IPC**：ZIP 文件对话框使用 `openFile` 和 `.zip` filter；取消不泄露路径；成功只返回第一条路径。
2. **preload / platform**：`selectZipFile` 与类型声明保持一致，非 Electron 环境安全取消。
3. **导入页面**：静态/组件测试断言三项 Tab 的中文标签、ZIP 选择按钮、ZIP 路径校验、生成 `kind: 'zip'` source，且不再渲染“npx skills 产物”。
4. **ZIP 端到端导入回归**：复用并补充 PackageInstaller 的 ZIP fixture，证明一个 ZIP 内的多个 `SKILL.md` 可完成 inspect、review、install；无效 ZIP 或安全策略失败仍被拒绝。
5. **现有来源回归**：本地目录与 GitHub Archive 的构造、扫描和安装测试继续通过。

## 非目标

- 不支持通过网页 HTTP 上传 ZIP 文件。
- 不执行 `npx`、安装脚本或 ZIP 内可执行文件。
- 不改变 ZIP 解压预算、安全限制、Import Review 审批模型或 Package 存储命名规则。
- 不改变已存在的本地目录和 GitHub Archive 导入交互。

## 验收标准

- 用户可在“导入skills zip”Tab 中打开原生文件选择器并选择 `.zip` 文件。
- 所选 ZIP 的完整绝对路径会显示在页面中。
- 包含一个或多个合法 `SKILL.md` 目录的 ZIP 能完成扫描、审批、安装，并出现在 Skills Center。
- ZIP 路径缺失、扩展名错误、损坏 ZIP 或触发安全策略时，用户看到可理解的错误且不会安装任何 Skill。
- UI 中没有“npx skills 产物”作为导入来源。
