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
  - 使用 `lstat` 区分 file、directory、symlink。
  - 对普通文件返回大小、修改时间、扩展名和有限二进制探测。
  - 通过共享 `PathPolicy` 和 approved roots 校验读取路径。
- `src/server/tools/workspace-search.ts`
  - 支持 `query`、`include`、`exclude`、`root`、`caseSensitive`、`maxResults`、`cursor`、`mode`。
  - 默认忽略 `.git`、`node_modules`、构建输出、缓存和配置目录。
  - 默认不跟随符号链接、不读取二进制文件。
  - 限制扫描文件数 2,000、深度 20、单文件 2 MiB、总读取 20 MiB。
- `src/server/tools/fs-apply-patch.ts`
  - 解析 unified diff，相对路径必须位于 approved root 内。
  - 默认 `dryRun: true`，返回文件、hunk、行数和冲突摘要。
  - 写入前重新解析路径、确认文件存在状态并重新计算内容 hash，发现 TOCTOU 变化时拒绝写入。
  - 对已有文件生成带 rollback token 的备份，并使用临时文件加 rename 原子写入。
  - 多文件写入失败时按已登记的 rollback entries 回滚。
- `src/server/tools/fs-edit.ts`
  - 支持 `expectedHash`，读取后发现内容变化时拒绝编辑。
  - 使用临时文件和 rename 完成原子替换。
- `src/server/tools/fs-glob.ts`、`src/server/tools/fs-grep.ts`
  - 保留旧入口并标记 deprecated，执行转发到 `workspace_search`。
- `src/server/tools/bash.ts`
  - 仅允许 `ls`、`cat`、`grep`、`find`、`pwd`、`wc`、`head`、`tail`、`diff`、`sort`、`uniq`、`tr`。
  - 通过结构化 command/args、approved cwd、超时和输出上限执行，不接受 shell 字符串拼接。
- `src/server/skills/policy/capability-broker.ts`
  - `fs_apply_patch` 的 `dryRun: false` 明确要求写权限。
  - 验证 session grant、permanent grant 和精确 one-time approval token。
- `scripts/migrations/028-tools-platform-b1.sql`、`src/server/db/client.ts`
  - 将 B1 工具加入现有安装的工具目录，并由 `seedTools()` 同步 canonical contract schema。
- B2 的真实浏览器、OCR 和 image-edit 后端未在 B1 伪造成功 executor；在依赖和隔离条件未满足前保持 unavailable。

## 自动化测试证据

### B1 定向验收

执行命令：

```text
npm run typecheck
exit code 0

npm test -- --run src/server/tools/fs-edit.test.ts src/server/tools/fs-stat.test.ts src/server/tools/workspace-search.test.ts src/server/tools/fs-apply-patch.test.ts src/server/tools/bash.test.ts src/server/skills/policy/capability-broker.test.ts src/server/db/migrations.test.ts --reporter=dot
```

结果：

```text
7 test files passed
34 tests passed
```

覆盖的验收场景：

- `fs_stat` 正确区分文件、目录和符号链接，并报告文件属性。
- `workspace_search` 支持文本匹配、glob 枚举、include/exclude、分页和资源上限。
- `workspace_search` 跳过二进制文件、符号链接和默认忽略目录。
- `fs_apply_patch` 默认只预览；错误 hunk、越界路径、缺失源文件和文件内容变化会报告冲突。
- `fs_apply_patch` 写入前二次 hash 检查阻止 TOCTOU 覆盖；成功写入可回滚。
- `fs_edit` 拒绝错误 `expectedHash`，并保持原子写入路径。
- Bash 拒绝破坏性命令，允许命令使用结构化参数。
- dry-run 不需要写授权；真实 patch 写入受 session、permanent 和 one-time grant 控制。
- 028 迁移可从空库和历史库升级，并保持幂等。

### 全量门禁

执行结果：

```text
npx vitest run --pool=forks --maxWorkers=1 --minWorkers=1 --silent --reporter=dot
exit code 0

Test Files 192 passed | 1 skipped (193)
Tests 850 passed | 1 skipped (851)

npm run build
passed

git diff --check
passed
```

## 验收结论

Release B1 验收通过。常见编码文件工作流已从弱 glob、无界 grep 和脆弱文本替换升级为统一 contract、路径策略、有界搜索、可预览 patch 和受授权原子写入。B2 的浏览器/OCR/image-edit 能力继续遵守“真实后端和守卫就绪后才可用”的发布门槛。
