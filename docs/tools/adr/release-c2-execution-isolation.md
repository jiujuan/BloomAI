# ADR：Release C2 执行工具隔离边界

## 状态

已记录，C2/C3 开放门槛未满足。

## 背景

`node_runner`、`python_runner` 和 `shell` 都可以执行动态代码或系统命令。进程超时、工作目录、环境变量和输出大小限制只能降低运行风险，不能把普通用户权限的子进程变成 OS 级沙箱。

特别是：

- `node:vm` 只提供 JavaScript 执行上下文，不隔离文件系统、网络、进程或资源；
- 普通 `spawn`/`execFile` 子进程仍继承当前用户的 OS 权限；
- Windows 与 POSIX 的进程树终止和权限边界不同，不能只用一套 shell wrapper 宣称跨平台隔离；
- 数据库中的 permanent grant 或一次性 approval token 不能替代进程级隔离。

## 选项评估

| 方案 | 优点 | 当前缺口 |
|---|---|---|
| Windows restricted token + Job Object / POSIX 受限用户与进程组 | 可保留本地执行体验，资源和进程树可控 | 需要实现跨平台账户、ACL、进程组、网络和清理集成测试 |
| 容器或轻量 VM | 隔离边界强，适合不可信代码 | 桌面端运行时、打包、启动失败降级和资源成本尚未定义 |
| 仅允许可信本地开发者模式 | 不会把不可信执行误开放给 Agent，部署复杂度最低 | 不提供不可信代码的 OS 隔离，不能作为 C3 的依据 |

## 决策

1. Release C1 交付一个统一的受控进程 runner，负责结构化 command/args、approved cwd、最小环境变量、超时、取消、输出上限、跨平台终止策略和结构化错误。
2. 在实现并验收 Windows restricted token/Job Object、POSIX 受限用户/进程组或容器/VM 之一之前，不把普通子进程视为隔离边界。
3. `node_runner`、`python_runner`、`shell` 保持 `disabled`，不进入 Agent tool surface；它们不能通过 HTTP body、数据库 permission 或工具 UI 绕过 availability gate。
4. Python 的 `packages` 只保留为显式拒绝的输入，不执行依赖安装。
5. 如未来提供可信本地开发者模式，必须是单独的显式配置和 UI 状态，文案不得称为 sandbox，也不得默认授予 Agent。

## C3 开放条件

只有同时满足下列条件，才可讨论将执行工具暴露给 Agent：

- 已选定并实现真实 OS 隔离后端，且 Windows 与 POSIX 均有集成测试；
- 隔离进程只能访问批准的工作目录和必要的 artifact 目录；
- 网络、环境变量、进程树、CPU/内存/输出/时间限制均有可观测拒绝证据；
- timeout/cancel 后不存在残留进程，清理超时有明确孤儿资源记录；
- one-time approval token 绑定 `toolId`、`sessionId`、`inputHash`，并在首次消费后失效；
- Agent surface、HTTP route、UI manual runner 的负向测试均确认不能绕过 availability 和 approval gate；
- 完成安全评审和 Windows 桌面 smoke test。

在这些条件满足前，C3 的验收结果固定为“未开放”，而不是把当前实现宣传成安全沙箱。
