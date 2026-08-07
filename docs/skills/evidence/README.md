# Skills Runtime 证据目录

本目录保存 Skills Runtime v1.1 的可复核验收证据。证据文件只记录脱敏后的摘要、命令、快照引用和审核结论；不得写入 API key、token、cookie、个人绝对路径或真实用户数据。

## 使用规则

1. 每个 P0/P1 任务至少绑定一个 `Task ID`、一个 commit SHA 和一个可重复的验证命令。
2. 运行证据必须来自干净的临时 DB/data root，并注明 Node、npm、OS 和当前分支。
3. API、migration、security、browser、release 证据分别填入对应模板；不要用“本地已验证”替代命令输出或快照。
4. 失败证据也要保留：记录失败命令、最小复现、根因、修复 commit 和重跑结果。
5. 任何快照都要脱敏：路径使用 `<TEMP_ROOT>`、密钥使用 `[REDACTED]`，只保留必要的字段名和 hash。

## 证据索引

| 证据 | 用途 | 生成方式 | 状态 |
|---|---|---|---|
| [API contract snapshot](./api-contract-snapshot.md) | DTO、错误码、幂等、SSE/afterSeq | `npm run test:skills:integration` | ☐ |
| [Migration schema snapshot](./migration-schema-snapshot.md) | migration ids、表、索引、不变量 | `npm run test:skills:migration` | ☐ |
| [Security scan](./security-scan.md) | P0 安全 negative cases 和脱敏 | `npm run test:skills:security` | ☐ |
| [Release gate](./release-gate.md) | 完整发布门禁、浏览器 trace/video、回滚演练 | `npm run test:skills:release-gate` | ☐ |
| [P0 baseline](./p0-baseline.md) | SKL12-P0-001 至 SKL12-P0-003：源码、Legacy 依赖、Runtime/权限/DTO 契约 | `npx tsx scripts/skills/p0-baseline-scan.ts --root .` | ✅ captured |
| [P0 DB inventory](./p0-db-inventory.json) | SKL12-P0-004：schema、行数、外键、孤儿、migration、备份和删除决策 | `npx tsx scripts/skills/p0-db-inventory.ts --database <real-db> --backup` | ✅ captured |

## 证据最小字段

- Task ID / 责任人 / reviewer
- 分支、commit SHA、生成时间（使用绝对日期和 UTC）
- 变更文件和 API/DTO/schema 版本
- 测试命令、退出码、测试文件/用例数量
- 快照/trace/video 的相对仓库路径或 CI artifact 名称
- 已知限制、失败重现和 rollback 状态

## 目录约定

- `browser/`：Playwright trace/video（失败时必须保留；成功时可由 CI artifact 保存）。
- `snapshots/`：脱敏 JSON/SQL schema snapshot。
- `reports/`：JUnit/coverage/security 报告。

如果上述目录由 CI 生成，不要把包含环境绝对路径或凭据的原始 artifact 提交到仓库；提交脱敏摘要并在 CI 中上传原始 artifact。
