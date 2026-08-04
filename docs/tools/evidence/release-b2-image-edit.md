# Release B2 image edit acceptance evidence

## Acceptance date

2026-08-04

## Scope

This PR delivers the image-edit availability boundary and records the
dependency, packaging, operation, resource, and artifact decisions. It does
not claim to implement image editing.

- `image_edit` reports `dependency_missing` with dependency key
  `image-processing-backend`;
- the database row remains disabled;
- the Agent surface omits `image_edit`;
- direct executor calls fail with `ToolUnavailableError`;
- no placeholder success result or output path is returned;
- no image-processing dependency, native binary, WASM asset, or remote provider
  was added.

## Evidence

- `src/server/tools/availability.ts`
  - keeps image editing unavailable until a backend decision is complete;
  - exposes a structured dependency and reason.
- `src/server/tools/image-edit.ts`
  - calls `requireToolAvailability('image_edit')` before any result can be
    returned.
- `src/server/tools/availability.test.ts`
  - verifies the dependency state, disabled database row, and Agent omission.
- `src/server/tools/image-edit.test.ts`
  - verifies the executor rejects with `ToolUnavailableError`;
  - verifies the rejection is not a successful placeholder result.
- `docs/tools/adr/release-b2-image-edit.md`
  - records backend, packaging, operations, resource-limit, path-policy, and
    artifact decision gates.

## Automated tests

Command:

```text
npm test -- src/server/tools/image-edit.test.ts src/server/tools/availability.test.ts --reporter=dot
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

Release B2 image-edit acceptance passes for the availability-governance scope.
Image editing is correctly unavailable and cannot be mistaken for a successful
transformation. Real implementation remains blocked on the ADR decision gates.
