# API Contract Snapshot（模板）

> 这是脱敏证据模板。将 `<...>` 替换为实际值；不要粘贴 Authorization、cookie、内部绝对路径或完整用户输入。

## 验收元数据

| 字段 | 值 |
|---|---|
| Task ID | `<SKL-P8-003 / ...>` |
| Branch | `feat/skills-system-v1.1-impl` |
| Commit | `<40-char SHA>` |
| Generated at (UTC) | `<YYYY-MM-DDTHH:mm:ssZ>` |
| Reviewer / status | `<name> / pending|accepted>` |

## 协议版本

- Package Runtime API version: `<...>`
- Manifest schema version: `<...>`
- Event schema version: `<...>`
- Runtime config/protocol version: `<...>`
- Legacy API compatibility: `<unchanged|exception with migration note>`

## Route / DTO / error matrix

| Route | Method | Request contract | Response DTO | Error codes | Idempotency/CAS | Evidence |
|---|---|---|---|---|---|---|
| `/api/v1/skill-packages/inspect` | POST | `<source schema>` | `<inspect result>` | `INVALID_SOURCE`, `PATH_NOT_ALLOWED`, ... | no DB side effect | `<snapshot/test>` |
| `/api/v1/skill-packages/install` | POST | `<review/fingerprint/confirmation>` | `<package/version/install>` | `REVIEW_REQUIRED`, `FINGERPRINT_MISMATCH`, ... | request key / transaction | `<snapshot/test>` |
| `/api/v1/skill-packages` | GET | pagination | package summary | `...` | stable cursor/offset | `<snapshot/test>` |
| `/api/v1/skill-runs` | POST | `<skillVersionId,input,context>` | run summary | `FEATURE_DISABLED`, `CONFLICT`, ... | idempotency key | `<snapshot/test>` |
| `/api/v1/skill-runs/:id/events` | GET/SSE | `afterSeq` | event envelope | `RUN_NOT_FOUND`, ... | sequence replay | `<snapshot/test>` |
| `/api/v1/skill-runs/:id/artifacts` | GET | pagination/sort | artifact summary | `ARTIFACT_OWNERSHIP_DENIED`, ... | run ownership | `<snapshot/test>` |
| `/api/v1/skill-runtime/capabilities` | GET | none | redacted capabilities | none | read-only | `<snapshot/test>` |
| `/api/v1/skill-runtime/health` | GET | none | liveness/readiness | none | read-only | `<snapshot/test>` |
| `/api/v1/skill-runtime/diagnostics` | GET | admin role | diagnostics snapshot | `FORBIDDEN` | read-only | `<snapshot/test>` |

## 典型脱敏响应

```json
{
  "data": {
    "protocolVersion": "1.1",
    "runtimeConfigVersion": "<CONFIG_VERSION>",
    "packageDataRoot": "<REDACTED_INTERNAL_PATH_NOT_EXPOSED>",
    "error": null
  }
}
```

必须确认：

- 不返回 secret/token、DB connection string、绝对 data root、内部堆栈。
- 禁用功能返回稳定 `FEATURE_DISABLED`，不能静默 404。
- 版本/安装/Run 更新遵守 immutable、revision/CAS 和幂等语义。
- SSE 断线可用 `afterSeq` 补偿，重复事件不会改变最终状态。

## 验证命令

```powershell
npm run typecheck:skills
npm run test:skills:integration
```

结果：`<exit code / test files / assertions>`

## 失败与修复记录

- Failed command / first symptom: `<...>`
- Root cause: `<...>`
- Fix commit: `<...>`
- Re-run evidence: `<...>`
