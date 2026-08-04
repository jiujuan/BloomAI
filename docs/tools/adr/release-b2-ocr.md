# ADR: OCR backend and availability boundary

## Status

Deferred implementation. OCR remains `dependency_missing` and disabled.

## Context

The public `ocr` tool is present in the tool catalog, but the repository does not
currently contain a configured OCR backend, language model assets, or a packaging
and privacy decision for offline recognition. Returning a successful placeholder
would make the catalog, Agent surface, and runtime behavior disagree.

The implementation plan requires these decisions before the tool can become
available:

- backend type: local binary, WASM, cloud service, or operating-system capability;
- supported languages and model/data footprint;
- offline behavior and privacy disclosure;
- license compatibility for the runtime and recognition data;
- output contract for pages, blocks, bounding boxes, and confidence.

## Options considered

| Option | Potential benefit | Decision gap |
|---|---|---|
| Bundled local backend | Offline execution and predictable privacy boundary | Binary/model size, platform packaging, language data, and license review |
| WASM backend | Fewer native packaging concerns | Performance, model delivery, memory limits, and license review |
| Configured cloud provider | Smaller desktop package and broad language coverage | Credentials, network/retention policy, privacy disclosure, and provider contract |
| System OCR capability | Reuses a platform feature where available | Cross-platform behavior, language coverage, and permission semantics |

No option is approved for this release. Adding an unreviewed dependency or
remote provider would violate the release boundary.

## Decision

1. Keep `ocr` at `dependency_missing` with dependency key `ocr-backend`.
2. Keep the database row disabled and omit the tool from the Agent surface.
3. Make the executor fail with `ToolUnavailableError`; it must not return a
   successful `{ note: ... }` placeholder.
4. Revisit implementation only after backend, model/data, license, packaging,
   privacy, and output-schema decisions are recorded and tested.

## Acceptance gate for a future OCR implementation

- Backend availability is probed without making a successful tool run look
  available when assets are missing.
- Language/model assets have bounded size and an explicit installation or
  packaging strategy.
- Input path and output artifacts use the shared `PathPolicy`.
- Recognition output has bounded text and structured confidence metadata.
- Cancellation, timeout, malformed input, oversized input, and audit records
  have automated tests.
- Windows and POSIX packaging/smoke checks pass before changing availability to
  `available`.
