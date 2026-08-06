# Security Scan（模板）

## 验收元数据

| 字段 | 值 |
|---|---|
| Task ID | `SKL-P8-001 / SKL-P8-003` |
| Branch | `feat/skills-system-v1.1-impl` |
| Commit | `<40-char SHA>` |
| Generated at (UTC) | `<YYYY-MM-DDTHH:mm:ssZ>` |
| Scanner | `Vitest offline security suite` |
| Reviewer / status | `<name> / pending|accepted>` |

## Negative-case matrix

| Case | Fixture/test | Expected result | Observed | Status |
|---|---|---|---|---|
| Zip Slip `..` | `malicious-path-package` | reject before read/install | `<...>` | ☐ |
| Absolute/drive path | package path policy | reject | `<...>` | ☐ |
| Canonical symlink escape | reader boundary test | reject outside root | `<...>` | ☐ |
| Invalid YAML/frontmatter | `invalid-manifest-package` | `MANIFEST_INVALID` | `<...>` | ☐ |
| Executable entry/script | malicious/npx fixture | static inspect only | `<...>` | ☐ |
| npx dependencies/hooks | `npx-artifact-package` | ignored, never executed | `<...>` | ☐ |
| shell/python/MCP | unsupported capability fixture | denied | `<...>` | ☐ |
| SSRF/noncanonical GitHub URL | source parser | denied | `<...>` | ☐ |
| GitHub redirect to non-official host | archive mock | `GITHUB_REDIRECT_BLOCKED` | `<...>` | ☐ |
| Archive hash/length | deterministic mock | stable hash; mismatch rejected | `<...>` | ☐ |
| Secret redaction | audit/event payload | `[REDACTED]`, no raw secret | `<...>` | ☐ |
| XSS/HTML | preview sanitizer | scripts/events/unsafe URL removed | `<...>` | ☐ |
| Cross-run artifact | ownership check | `ARTIFACT_OWNERSHIP_DENIED` | `<...>` | ☐ |
| Budget exhaustion | file/archive/payload limits | stable limit error | `<...>` | ☐ |
| Image artifact contract | image-reference policy | MIME/extension/ownership validated | `<...>` | ☐ |

## Command evidence

```powershell
npm run test:skills:security
```

Result: `<exit code / files / assertions>`

## Redaction review

- [ ] No token, cookie, Authorization header, prompt, or private key in logs/snapshots.
- [ ] No external network call occurred; all GitHub/LLM/image flows are deterministic mocks.
- [ ] No test used the development DB or a real user directory.
- [ ] Failure traces contain only sanitized paths and payloads.

## Residual risk / accepted exception

`<none or explicit owner, expiry date, mitigation>`
