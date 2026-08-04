# Release C 验收证据

## 验收日期

2026-08-04

## 范围

本次交付完成 Release C1 的受控执行基线，并完成 C2 隔离决策记录：

- 新增统一 `runControlledProcess`；
- `bash` 迁移到结构化 command/args、approved cwd、最小环境变量、超时、取消和输出上限；
- Node/Python/Shell 统一接入 availability gate，并保持默认 `disabled`；
- Node VM 文案明确不是 OS sandbox；
- Python `packages` 不执行依赖安装；
- tool runtime 将 process timeout/cancelled 记录为对应运行状态；
- 新增 C2 ADR，明确真实隔离后端和 C3 Agent 开放门槛。

本次不宣称 C2 OS 级隔离或 C3 Agent 开放已完成。执行工具继续保持禁用是验收要求的一部分。

## 实现证据

- `src/server/tools/utils/process-runner.ts`
  - `shell: false`，command 与 args 分离；
  - cwd 经过 `PathPolicy` 和 approved roots 校验；
  - 环境变量限制为固定 allowlist；
  - timeout 和 `AbortSignal` 触发进程树终止；
  - stdout/stderr 保存内容和累计字节数均有上限，并记录 `truncated`；
  - Windows 使用 `taskkill /T /F`，POSIX 使用 `SIGTERM` 后 `SIGKILL`；
  - 返回 `PROCESS_TIMEOUT`、`PROCESS_CANCELLED`、`PROCESS_OUTPUT_LIMIT` 等结构化错误。
- `src/server/tools/bash.ts`
  - 只执行既有 allowlist 命令；
  - 使用受控 runner，不再调用无取消/无进程树治理的旧包装。
- `src/server/tools/node-runner.ts`
  - 直接执行前检查 `node_runner` availability；
  - 描述明确 `node:vm` 不是 OS sandbox。
- `src/server/tools/python-runner.ts`
  - 使用跨平台 Python 命令选择；
  - 禁止依赖自动安装；
  - 使用受控 runner 和统一输出限制。
- `src/server/tools/shell.ts`
  - 使用受控 runner 和最小环境变量；
  - 在 C2 通过前保持 disabled。
- `src/server/tools/availability.ts`、`src/server/mastra/tools.ts`
  - execution tools 不暴露给 Agent。
- `docs/tools/adr/release-c2-execution-isolation.md`
  - 记录 C2 方案评估、当前决策及 C3 开放条件。

## 自动化测试证据

### C1 定向测试

执行命令：

```text
npm test -- src/server/tools/utils/process-runner.test.ts src/server/tools/bash.test.ts src/server/tools/availability.test.ts src/server/tools/tool-runtime.test.ts --reporter=dot
```

结果：

```text
4 test files passed
18 tests passed
exit code 0
```

覆盖场景：

- command/args 不经过 shell expansion；
- cwd 越过 approved roots 被拒绝；
- timeout 终止进程并返回 `PROCESS_TIMEOUT`；
- AbortSignal 终止进程并返回 `PROCESS_CANCELLED`；
- stdout/stderr 超限时保留有界内容并标记截断；
- 环境变量只允许固定最小 allowlist；
- Windows/POSIX 使用不同的进程树终止策略；
- execution tools 保持 disabled，不进入 Agent surface；
- Python packages 不触发依赖安装；
- tool runtime 正确记录 process timeout/cancelled 状态。

### 工程门禁

```text
npm run typecheck
passed

npm run build
passed

git diff --check
passed
```

### 全量回归

执行命令：

```text
npx vitest run --pool=forks --maxWorkers=1 --minWorkers=1 --reporter=dot --silent
```

结果：

```text
Test Files 198 passed | 2 skipped (200)
Tests 871 passed | 2 skipped (873)
exit code 0
```

## C2/C3 验收结论

| 门槛 | 结果 | 证据 |
|---|---|---|
| C1 受控 runner | 通过 | runner 单元测试与 tool runtime 测试 |
| C2 真实 OS 隔离 | 未通过/未开放 | `docs/tools/adr/release-c2-execution-isolation.md` |
| C3 Agent 一次性批准执行 | 未开放 | availability gate 和 Agent surface 负向测试 |

当前正确状态是：C1 已交付，C2/C3 按安全门槛保持关闭。没有将 `node:vm`、普通子进程或数据库授权误报为 OS 级 sandbox。
