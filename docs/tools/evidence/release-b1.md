# Release B1 验收证据

## 范围

Release B1 完成受控文件工作流升级：

- `fs_stat` 提供文件、目录和符号链接元信息。
- `workspace_search` 提供有界文本搜索和 glob 文件枚举。
- `fs_apply_patch` 提供默认 dry-run、冲突检测、原子写入、备份和 rollback token。
- `fs_glob`、`fs_grep` 保留为 deprecated wrapper，统一转到 `workspace_search`。
- `fs_edit` 增加 `expectedHash` 和原子写入。
- `bash` 收缩为有界只读结构化命令。
- 实际文件写入继续受 session grant、permanent grant 或精确 one-time approval token 约束。

## 实现证据

- `src/server/tools/fs-stat.ts`
  - 使用 `lstat` 区分 file、directory 和 symlink。
  - 对普通文件返回大小、修改时间、扩展名和有限二进制探测。
  - 通过共享 `PathPolicy` 和 approved roots 校验读取路径。
- `src/server/tools/workspace-search.ts`
  - 支持 `query`、`include`、`exclude`、`root`、`caseSensitive`、`maxResults`、`cursor`、`mode`。
  - 默认忽略 `.git`、`node_modules`、构建输出、缓存和配置目录。
  - 默认不跟随符号链接、不读取二进制文件。
  - 限制扫描文件数、深度、单文件大小和总读取量。
- `src/server/tools/fs-apply-patch.ts`
  - 解析 unified diff，相对路径必须位于 approved root 内。
  - 默认 `dryRun: true`，返回文件、hunk、行数和冲突摘要。
  - 写入前二次检查文件状态和内容 hash，发现 TOCTOU 变化时拒绝写入。
  - 对已有文件生成受控备份，并使用临时文件加 rename 写入。
  - 多文件 patch 冲突、重复目标、写入失败和 rollback 后续变化均不产生静默覆盖。
  - 新建、修改和删除文件均在可恢复条件下返回 rollback token。
- `src/server/tools/fs-edit.ts`
  - 支持 `expectedHash`，读取后发现内容变化时拒绝编辑。
  - 使用临时文件和 rename 完成原子替换。
- `src/server/tools/fs-glob.ts`、`src/server/tools/fs-grep.ts`
  - 保留旧入口并标记 deprecated，执行转发到 `workspace_search`。
- `src/server/tools/bash.ts`
  - 仅允许结构化的只读命令集合，不接受破坏性命令。
  - 通过 approved cwd、超时和输出上限执行。
- `src/server/skills/policy/capability-broker.ts`
  - `fs_apply_patch` 的 `dryRun: false` 明确要求写权限。
  - 验证 session grant、permanent grant 和精确 one-time approval token。
- `scripts/migrations/028-tools-platform-b1.sql`
  - 注册 B1 workspace tools。
- `scripts/migrations/029-tools-platform-b1-patch.sql`
  - 独立注册 `fs_apply_patch`，不修改已提交的 `028` migration。

## 自动化测试证据

### PR-12 定向验收

执行命令：

```text
npm test -- --run src/server/tools/fs-apply-patch.test.ts src/server/skills/policy/capability-broker.test.ts src/server/tools/contracts.test.ts src/server/db/migrations.test.ts
```

结果：

```text
4 test files passed
29 tests passed
exit code 0
```

覆盖的验收场景：

- 默认 dry-run 不写文件，且不需要审批。
- 越界、绝对路径和非法 patch 被拒绝。
- hunk 冲突、多文件冲突和重复目标不产生部分写入。
- 写入使用备份和 rollback token。
- 新建、删除文件可以恢复。
- rollback 发现文件被修改或删除时拒绝覆盖。
- one-time approval 首次可用，重复消费被拒绝。
- migration 可从空库和历史库升级，并保持幂等。

### B1 全量定向验收

执行命令：

```text
npm test -- --run src/server/tools/fs-edit.test.ts src/server/tools/fs-stat.test.ts src/server/tools/workspace-search.test.ts src/server/tools/fs-apply-patch.test.ts src/server/tools/bash.test.ts src/server/tools/contracts.test.ts src/server/skills/policy/capability-broker.test.ts src/server/db/migrations.test.ts
```

结果：

```text
8 test files passed
38 tests passed
exit code 0
```

### 工程门禁

```text
npm run typecheck
passed

npm run build
passed

npm test -- --reporter=dot
all test files passed
all tests passed
exit code 0

git diff --check
passed

secret scan
no real credentials; matches were empty setting keys and an intentional test fixture secret
```

## 验收结论

Release B1 的文件工作流、路径边界、写入授权、冲突保护和回滚证据已具备。B2 的浏览器/OCR/image-edit 后端以及 Release C 的执行隔离不在本 PR 中改变；未满足依赖或隔离门槛的工具继续保持 unavailable 或 disabled。
