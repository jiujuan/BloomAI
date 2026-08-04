# ADR: Image edit backend and artifact boundary

## Status

Deferred implementation. `image_edit` remains `dependency_missing` and disabled.

## Context

The public `image_edit` tool is listed in the catalog, but no image-processing
backend has been approved for desktop packaging, supported operations, resource
limits, or artifact policy. A successful placeholder would imply that an edit
was performed when no output exists.

The implementation plan requires decisions for:

- the image-processing dependency and Electron packaging compatibility;
- the supported operation set: resize, crop, rotate, format, quality, and
  metadata stripping;
- `outputPath` enforcement through the shared `PathPolicy`;
- default non-overwrite behavior;
- MIME, file-size, pixel-count, and decompression-bomb limits before decoding.

## Options considered

| Option | Potential benefit | Decision gap |
|---|---|---|
| Native image library | Mature codecs and fast transforms | Native binaries, Electron ABI packaging, platform smoke tests, and license review |
| WASM image library | More uniform packaging and fewer native modules | Memory/CPU limits, codec coverage, and bundle size |
| External command-line backend | Can reuse an installed system capability | Binary discovery, command/argument safety, output validation, and platform behavior |
| Remote image service | Small local package and broad format support | Network policy, privacy/retention, credentials, and output ownership |

No option is approved for this release. The tool must not add a dependency or
invoke an uncontrolled external process until the decision gates are complete.

## Decision

1. Keep `image_edit` at `dependency_missing` with dependency key
   `image-processing-backend`.
2. Keep the database row disabled and omit the tool from the Agent surface.
3. Make the executor fail with `ToolUnavailableError`; it must not return a
   successful `{ note: ... }` placeholder or claim an output path.
4. Preserve the future contract boundary: all input and output paths will use
   `PathPolicy`, and the default behavior will create a new artifact.
5. Revisit implementation only after dependency, packaging, operation,
   resource-limit, and artifact-policy decisions are recorded and tested.

## Acceptance gate for a future image-edit implementation

- Supported operations and their schemas are explicit and reject unknown or
  ambiguous operations.
- MIME, byte-size, pixel-count, and decode-time limits are enforced before and
  during processing.
- Source files are not overwritten by default.
- Output paths remain under approved roots and successful outputs are regular
  files with validated format and size metadata.
- Cancellation, timeout, malformed input, oversized input, decompression-bomb
  fixtures, and audit records have automated tests.
- Windows and POSIX packaging/smoke checks pass before changing availability to
  `available`.
