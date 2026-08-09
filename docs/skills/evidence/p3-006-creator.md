# P3-006 Creator 验收证据

- 任务：`SKL12-P3-006` Skills Creator 页面
- 分支：`feat/skills-admin-system`
- 验收日期：2026-08-08
- 目标：实现 Draft 自动保存/revision 冲突处理、Package Runtime 约束、Capability 风险提示、Validate/Preview/Publish 门禁，以及发布后的 Package/Version/Installation 追踪。

## TDD / Red 记录

实现前的工作区 Red 记录显示 Creator 新增契约测试共 7 项，其中 3 项失败：no-draft Creator 未明确显示 `Package Runtime`，高风险 Capability 风险函数/提示尚未接线，Publish Package relation 解析尚未实现。失败原因与待实现行为一致，未用放宽断言替代实现。

## 代码与契约验收

- `SkillCreatorWorkbench`：
  - 以 `revision` 作为 autosave 的 `expectedRevision`；600ms debounce 后调用 server update。
  - 服务端返回成功后更新 revision/content，并显示 `Autosave 已保存`。
  - `REVISION_CONFLICT` 设置冲突状态，保留本地编辑，明确提供刷新 server truth 动作，不静默覆盖。
  - Validate 未通过时 Preview 被禁用/阻止；Validation 或 Preview evidence 不完整时 Publish 被禁用/阻止。
  - Publish 成功后展示 Package、Version、Installation 关系，并通过 `onPublished` 把 server 返回的 Package ID 交给上层导航。
- `SkillCreatorEditor`：
  - Runtime 选择器只有不可编辑的 `Package Runtime` 选项，Creator 页面不提供 `Legacy Runtime`。
  - `command`、`workspace_write`、`shell.execute`、`file.write`、`package.install` 等高风险 Capability 显示“高风险 · 需要审批”；中风险 Capability 显示审批确认提示。
  - 文件资产只接受受限相对路径，禁止绝对路径、路径穿越和可执行扩展名。
- API/DTO：
  - Draft 响应统一归一化为 `runtimeKind: package`。
  - Publish 响应支持 camelCase、snake_case 以及嵌套 `package.id`、`version.id`、`installation.id`，导航只使用 server 返回的 Package relation。
  - Markdown Preview 使用 `skipHtml` 和脱敏函数，不执行 HTML/script/event 属性。
- `SkillsCenterWorkbench`：新建 Draft 和从导入 inspection 创建 Draft 都显式写入 `runtimeKind: package`；发布后根据 Package ID 打开 Package Detail，无 Package relation 时安全回到 Skills Center。

## 测试与结果

```text
npx vitest run src/renderer/pages/Skills/SkillCreatorWorkbench.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1
1 file passed, 7 tests passed

npx vitest run src/renderer/pages/Skills/skill-runtime.api.test.ts --pool=forks --maxWorkers=1 --minWorkers=1
1 file passed, 8 tests passed

npx vitest run src/renderer/pages/Skills --pool=forks --maxWorkers=1 --minWorkers=1
10 files passed, 55 tests passed

npx tsc --noEmit
passed

git diff --check
passed
```

## 结论

P3-006 的 Creator 页面契约和关键安全边界已通过单文件、API、Renderer Skills 全量测试及 TypeScript 检查；validation error 会阻止 Preview/Publish，发布关系由 server DTO 驱动，满足进入独立 commit/push 的验收门槛。
