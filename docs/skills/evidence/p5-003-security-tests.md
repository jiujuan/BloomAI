# P5-003 安全测试证据

- **Task ID**：`SKL12-P5-003`
- **分支**：`feat/skills-admin-system`
- **生成时间**：2026-08-08T17:58:40Z（UTC）
- **提交**：本文件随 P5-003 独立提交；最终 SHA 可通过 `git log --follow --format=%H -- docs/skills/evidence/p5-003-security-tests.md` 复核。

## 门禁范围

将 `test:skills:security` 从只运行 `tests/security` 扩展为显式覆盖 Skills Runtime/Admin 安全边界和 P4 Legacy boundary：

- source/SSRF/redirect/content-length/immutable archive：`github-source.test.ts`、`tests/security/skills-security.test.ts`；
- 路径穿越、绝对路径、UNC、NUL、深度/长度限制、symlink escape、受控 run/export root：`skill-path-policy.test.ts`、`package-path-policy.test.ts`、`package-reader.test.ts`、`tests/security/skills-security.test.ts`；
- 压缩包/文件/读取/聚合预算、恶意脚本和 executable/npx rejection：`package-reader.test.ts`、`npx-artifact-detector.test.ts`、`manifest-resolver.test.ts`、`tests/security/skills-security.test.ts`；
- Capability allowlist、scope、ownership、session、expired grant、budget、idempotency 和 broker boundary：`capability-policy.test.ts`、`capability-broker.test.ts`、`capability-broker.integration.test.ts`；
- Artifact ownership、export path、metadata/content budget、retention：`artifact-security.test.ts`；
- 审计字段、深度/宽度限制和敏感值脱敏：`skill-security.test.ts`、`security-audit.service.test.ts`、`package-install-review.service.test.ts`、`secret-redactor.test.ts`、`tests/security/legacy-migration.offline-read-only.security.test.ts`；
- HTTP 管理员授权、CORS/origin 和 Legacy bypass route boundary：`skill-security.test.ts`、`p4-002-legacy-boundary.test.ts`。

## 验收命令与结果

```text
npm run test:skills:security
```

结果：**18 test files passed，121 tests passed，退出码 0**；Vitest duration 43.21s。门禁使用单 worker/fork 配置，确保临时数据库和安全 fixture 的执行确定性。

另执行：

```text
git diff --check
```

结果：通过，无 whitespace error。

安全测试中输出的 `GET /api/v1/skills/... 404`、非管理员 `403`、非法 settings/权限拒绝等属于预期 negative cases；没有把拒绝响应当作测试失败，也未将真实凭据写入证据。

## 验收结论

- [x] 路径穿越、symlink、导出目录逃逸和 package/file/archive limits 纳入 gate。
- [x] 非法 source、redirect、manifest、executable/npx artifact 纳入 gate。
- [x] Capability scope/ownership/expired grant/usage/idempotency 纳入 gate。
- [x] audit payload、security decision、migration report 和 package review 的 secret redaction 纳入 gate。
- [x] Legacy bypass route boundary 纳入 gate。
- [x] 18 files / 121 tests 全部通过。

## 风险与回滚

本任务只扩大安全门禁测试集合，不改变 production security policy。门禁时间增加约 43 秒；如后续出现 fixture 不确定性，应修复 fixture 隔离或测试本身，不删减安全覆盖。回滚方式为回退本任务独立 commit，恢复只运行 `tests/security` 的旧命令集合。
