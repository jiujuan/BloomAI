# SKL12-P3-001 验收证据：Renderer API Client、DTO 与 Runtime Store

## 任务范围

- **任务编号：** `SKL12-P3-001`
- **实施计划：** `docs/skills/006-skills-admin-v1.2-implementation-plan.md` §6.4
- **验收日期：** 2026-08-08
- **分支：** `feat/skills-admin-system`

## 实现文件

- `src/renderer/api/index.ts`
- `src/renderer/pages/Skills/skill-runtime.types.ts`
- `src/renderer/pages/Skills/skill-runtime.store.ts`
- `src/renderer/pages/Skills/skill-runtime.api.test.ts`
- `src/renderer/pages/Skills/skill-runtime.store.test.ts`

## 验收点与证据

1. **API URL 与 ID 边界**
   - Package 列表筛选使用 `URLSearchParams`，搜索词、source type、排序参数均进行 URL 编码。
   - Package、Draft、Run、Version、Artifact 等动态 ID 使用 `encodeURIComponent`，Renderer 不直接拼接未编码 ID。
   - API 定向测试覆盖特殊字符筛选与 `draft/1` 动态 ID。
2. **DTO 契约转换**
   - API Client 将 snake_case 响应转换为 Renderer 使用的 camelCase DTO。
   - Runtime settings、feature flags、inspection、draft validation/preview 等响应均走转换函数。
   - API 定向测试覆盖 package、inspection、settings、feature flags 与 draft DTO。
3. **并发与 loading/error 状态**
   - Store 对 packages、package detail、versions、runs、drafts 使用 per-resource loading 与 request revision guard。
   - 旧请求在新请求完成后返回时不会覆盖新状态。
4. **Mutation 与 optimistic rollback**
   - Installation enable/disable 使用 optimistic update。
   - 请求失败时恢复 snapshot，记录结构化 `RuntimeError`、mutation error 状态和可读 error toast。
   - 成功 mutation 记录 success 状态并产生 success toast。
5. **Run Event Stream**
   - Run event 按 `runId + seq` 去重并按 seq 排序。
   - cursor 随最新事件推进；重连使用最后 cursor 补偿拉取；订阅重建不会重复事件。
   - 已覆盖 SSE 断线/重连与 event cursor 行为。

## 执行命令与结果

```text
npm run typecheck
通过（tsc --noEmit）

npm test -- --run src/renderer/pages/Skills/skill-runtime.api.test.ts src/renderer/pages/Skills/skill-runtime.store.test.ts
通过：2 test files passed，18 tests passed

npm test -- --run src/renderer/pages/Skills/skill-runtime.api.test.ts src/renderer/pages/Skills/skill-runtime.store.test.ts src/renderer/pages/Skills/SkillsCenterWorkbench.test.tsx src/renderer/pages/Skills/SkillCreatorWorkbench.test.tsx src/renderer/pages/Skills/SkillRuntimeDiagnostics.test.tsx src/renderer/pages/Skills/run-detail.test.tsx
通过：6 test files passed，36 tests passed
```

## Git 验证

- **验收前工作区约束：** 仅将本任务实现文件和本证据文件显式加入提交；用户已有文档、资源改动保持未提交。
- **commit SHA：** 由本任务独立提交产生，见提交后的 `git rev-parse HEAD`。
- **remote SHA：** 由 `git ls-remote origin refs/heads/feat/skills-admin-system` 验证，并应与本地 SHA 一致。
