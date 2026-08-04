# Release B2 OCR acceptance evidence

## Acceptance date

2026-08-04

## Scope

This PR delivers the OCR availability boundary and records the dependency
decision. It does not claim to implement OCR recognition.

- `ocr` reports `dependency_missing` with dependency key `ocr-backend`;
- the database row remains disabled;
- the Agent surface omits `ocr`;
- direct executor calls fail with `ToolUnavailableError`;
- no placeholder success result is returned;
- no OCR dependency, model asset, network provider, or package metadata was
  added.

## Evidence

- `src/server/tools/availability.ts`
  - keeps OCR unavailable until a backend decision is complete;
  - exposes a structured dependency and reason.
- `src/server/tools/ocr.ts`
  - calls `requireToolAvailability('ocr')` before any result can be returned.
- `src/server/tools/availability.test.ts`
  - verifies the dependency state, disabled database row, and Agent omission.
- `src/server/tools/ocr.test.ts`
  - verifies the executor rejects with `ToolUnavailableError`;
  - verifies the rejection is not a successful placeholder result.
- `docs/tools/adr/release-b2-ocr.md`
  - records backend, model/data, license, packaging, privacy, and output-schema
    decision gates.

## Automated tests

Command:

```text
npm test -- src/server/tools/ocr.test.ts src/server/tools/availability.test.ts --reporter=dot
```

Expected result:

```text
2 test files passed
6 tests passed
exit code 0
```

Additional gates:

```text
npm run typecheck
passed

npm run build
passed

git diff --check
passed
```

## Acceptance conclusion

Release B2 OCR acceptance passes for the availability-governance scope. OCR is
correctly unavailable and cannot be mistaken for a successful recognition
capability. Real OCR implementation remains blocked on the ADR decision gates.
