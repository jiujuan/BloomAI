# P1-002 Package 导入、Manifest 与 Import Review 验收证据

- 任务：`SKL12-P1-002`
- 分支：`feat/skills-admin-system`
- 验收日期：2026-08-07

## 实现范围

- `src/server/skills/packages/package-installer.ts`
  - 导出并统一规范化 local directory、ZIP、GitHub archive source；所有 inspect/install/materialize 路径在安全边界再次校验。
  - ZIP、GitHub archive 和本地目录统一执行 safe read、路径/文件/目录预算检查和 Manifest 诊断。
  - GitHub archive 解压后执行 npx artifact 检测，清理 `node_modules`、package manifest、scripts、hooks、`.git` 和可执行安装输入；不执行安装脚本并保存 disclaimer。
  - 非法 Manifest error 拒绝导入；warning/unsupported capability 进入 `warning` Import Review。
  - 安装成功保存 source digest、GitHub resolved commit、archive digest、文件快照和每个文件 checksum/size。
- `src/server/skills/packages/package-install-review.service.ts`
  - Import Review 支持 `scanning`、`validated`、`warning`、`pending`、`approved`、`rejected`、`installed` 状态。
  - review payload 通过安全清理后持久化，source fingerprint 与显式 confirm 必须匹配。
- `src/server/skills/packages/package-installer.test.ts`
  - 补充 source normalize、非法 source、未知 capability warning/review 的验收测试。

## 验收命令与结果

```text
npm test -- --run \
  src/server/skills/packages/manifest-resolver.test.ts \
  src/server/skills/packages/package-reader.test.ts \
  src/server/skills/packages/package-path-policy.test.ts \
  src/server/skills/packages/github-source.test.ts \
  src/server/skills/packages/npx-artifact-detector.test.ts \
  src/server/skills/packages/package-install-review.service.test.ts \
  src/server/skills/packages/package-installer.test.ts
```

结果：`7 files passed`，`56 tests passed`。

```text
npm run typecheck:skills
```

结果：退出码 `0`。

## 验收覆盖

| 风险/契约 | 证据 |
|---|---|
| source normalize 与非法来源拒绝 | `package-installer.test.ts` 的 normalize 测试；GitHub ref/host 测试 |
| 路径穿越、符号链接、硬链接、超大文件、损坏 ZIP | `package-path-policy.test.ts`、`package-installer.test.ts` |
| Manifest 解析、非法 Manifest 拒绝 | `manifest-resolver.test.ts`、`package-installer.test.ts` |
| 未知 Capability 进入 warning/review | `package-installer.test.ts` 的 warning review 测试 |
| npx artifact 不执行脚本并保存 disclaimer | `npx-artifact-detector.test.ts`、`package-installer.test.ts` |
| GitHub ref/commit/archive 可复现 | `github-source.test.ts`、`package-installer.test.ts` |
| digest、commit、文件快照持久化 | `package-installer.test.ts` 的 ZIP/GitHub 安装测试 |
| Import Review payload 脱敏与幂等安装 | `package-install-review.service.test.ts`、`package-installer.test.ts` |
