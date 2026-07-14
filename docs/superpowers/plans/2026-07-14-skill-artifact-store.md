# Skill Artifact Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store Skill Run artifacts in per-run directories derived from `DATA_DIR`, expose them by artifact ID, and safely export them to a user-selected directory.

**Architecture:** `ArtifactStore` owns all artifact filesystem operations under `<DATA_DIR>/skills/runs/<runId>/artifacts`. It accepts only a controlled artifact kind and relative filename, calculates MIME/size/SHA-256, then persists metadata through `skillPackageRepo`; the database stores a relative artifact path only. Renderers and callers resolve bytes by artifact ID rather than any raw local path. Run artifact directories are deliberately retained when a run is removed to preserve audit/export history.

**Tech Stack:** TypeScript, Node.js `fs/path/crypto`, Zod, Drizzle ORM/SQLite, Vitest.

---

## File Structure

- Create: `src/server/skills/artifacts/artifact-store.ts` - Artifact write/read/export operations, validation and file isolation.
- Create: `src/server/skills/artifacts/artifact-store.test.ts` - Real filesystem and SQLite tests.
- Modify: `src/server/db/paths.ts` - Derive the Skill Run artifact root from existing `DATA_DIR`.
- Modify: `src/server/db/repositories/skill-package.repo.ts` - Look up and list artifact metadata by run and artifact ID.
- Modify: `src/server/skills/artifacts/index.ts` - Export the public artifact store API.
- Modify: `docs/skills/skill-package-runtime-b-lite-implementation-todo.md` - Mark TODO 10 complete.

### Task 1: Define Artifact Paths and Repository Lookups

**Files:**
- Modify: `src/server/db/paths.ts`
- Modify: `src/server/db/repositories/skill-package.repo.ts`
- Test: `src/server/skills/artifacts/artifact-store.test.ts`

- [ ] **Step 1: Write failing path and lookup tests**

```ts
expect(getSkillRunArtifactsDir('run-1')).toBe(path.join(dataDir, 'skills', 'runs', 'run-1', 'artifacts'))
expect(skillPackageRepo.getArtifact(artifact.id)?.path).toBe('summary.md')
expect(skillPackageRepo.listArtifacts(run.id)).toHaveLength(1)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/server/skills/artifacts/artifact-store.test.ts`

Expected: FAIL because `getSkillRunArtifactsDir`, `getArtifact`, and `listArtifacts` do not exist.

- [ ] **Step 3: Add minimal path and metadata APIs**

```ts
export function getSkillRunArtifactsDir(runId: string): string {
  return path.join(getDataDir(), 'skills', 'runs', runId, 'artifacts')
}

getArtifact(id: string) {
  return getOrmDb().select().from(skill_artifacts).where(eq(skill_artifacts.id, id)).get()
},

listArtifacts(runId: string) {
  return getOrmDb().select().from(skill_artifacts)
    .where(eq(skill_artifacts.run_id, runId)).orderBy(asc(skill_artifacts.created_at)).all()
},
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/server/skills/artifacts/artifact-store.test.ts`

Expected: PASS.

### Task 2: Implement Controlled Artifact Writes and Reads

**Files:**
- Create: `src/server/skills/artifacts/artifact-store.ts`
- Create: `src/server/skills/artifacts/artifact-store.test.ts`
- Modify: `src/server/skills/artifacts/index.ts`

- [ ] **Step 1: Write failing storage tests**

```ts
const artifact = store.writeText({ runId: run.id, kind: 'markdown', fileName: 'summary.md', content: '# Result' })

expect(artifact).toMatchObject({ kind: 'markdown', path: 'summary.md', mime_type: 'text/markdown', size_bytes: 8 })
expect(fs.readFileSync(path.join(getSkillRunArtifactsDir(run.id), 'summary.md'), 'utf8')).toBe('# Result')
expect(store.readContent(artifact.id)).toEqual({ mimeType: 'text/markdown', content: Buffer.from('# Result') })
```

Also add table-driven tests for `json`, `prompt`, `image-reference`, and `directory-manifest`, asserting each persisted MIME type. Assert invalid combinations such as `{ kind: 'markdown', fileName: 'result.json' }` and unsafe names such as `../outside.md`, absolute paths, and `nested/file.md` throw an `ArtifactStoreError`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/server/skills/artifacts/artifact-store.test.ts`

Expected: FAIL because `ArtifactStore` does not exist.

- [ ] **Step 3: Implement controlled write and read APIs**

```ts
type ArtifactKind = 'markdown' | 'json' | 'prompt' | 'image-reference' | 'directory-manifest'

writeText(input: { runId: string; kind: Exclude<ArtifactKind, 'image-reference'>; fileName: string; content: string; metadata?: Record<string, unknown> }): StoredArtifact
writeImageReference(input: { runId: string; fileName: string; reference: Record<string, unknown>; metadata?: Record<string, unknown> }): StoredArtifact
readContent(artifactId: string): { mimeType: string; content: Buffer }
```

The allowed filename is exactly one basename with the required extension: `.md`, `.json`, `.txt`, `.json`, `.json` respectively. `writeImageReference()` stores a JSON document with an `application/vnd.bloomai.image-reference+json` MIME type. All writes create the run directory, use `fs.writeFileSync` with mode `0o600`, compute SHA-256 from the written bytes, and call `skillPackageRepo.createArtifact()` with a relative path only.

`readContent()` must load metadata by ID, derive its path from `run_id`, verify canonical containment in that run artifact directory, reject symbolic links/non-regular files, and re-check SHA-256 against the database metadata before returning bytes. It must never return an absolute filesystem path.

- [ ] **Step 4: Run storage tests to verify they pass**

Run: `npm test -- src/server/skills/artifacts/artifact-store.test.ts`

Expected: PASS.

### Task 3: Implement Safe Export and Retention Policy

**Files:**
- Modify: `src/server/skills/artifacts/artifact-store.ts`
- Modify: `src/server/skills/artifacts/artifact-store.test.ts`

- [ ] **Step 1: Write failing export and retention tests**

```ts
const exported = store.exportArtifact({ artifactId: artifact.id, destinationDir })
expect(exported).toBe(path.join(destinationDir, 'summary.md'))
expect(fs.readFileSync(exported, 'utf8')).toBe('# Result')

expect(() => store.exportArtifact({ artifactId: artifact.id, destinationDir: path.join(destinationDir, '..', 'unsafe') })).toThrow(ArtifactStoreError)
store.removeRun(run.id)
expect(fs.existsSync(getSkillRunArtifactsDir(run.id))).toBe(true)
```

- [ ] **Step 2: Run export tests to verify they fail**

Run: `npm test -- src/server/skills/artifacts/artifact-store.test.ts`

Expected: FAIL because export and run removal policy do not exist.

- [ ] **Step 3: Implement export and retain-on-remove behavior**

```ts
exportArtifact(input: { artifactId: string; destinationDir: string }): string {
  const destination = requireExistingDirectory(input.destinationDir)
  const source = this.resolveArtifactFile(input.artifactId)
  const target = path.join(destination, path.basename(source.relativePath))
  fs.copyFileSync(source.fullPath, target, fs.constants.COPYFILE_EXCL)
  return target
}

removeRun(runId: string): void {
  // Retention policy: do not delete <DATA_DIR>/skills/runs/<runId>/artifacts.
  // Future DB run deletion must preserve artifact rows/files for audit history.
}
```

`destinationDir` must already exist, must be a canonical non-symlink directory, and the target must not already exist. Do not create arbitrary user directories. The method returns the resulting export path to the caller; renderer-facing artifact reads remain ID-based.

- [ ] **Step 4: Run export tests to verify they pass**

Run: `npm test -- src/server/skills/artifacts/artifact-store.test.ts`

Expected: PASS.

### Task 4: Documentation and Full Verification

**Files:**
- Modify: `docs/skills/skill-package-runtime-b-lite-implementation-todo.md`

- [ ] **Step 1: Mark TODO 10 complete**

Change only TODO 10 checkboxes to `[x]` after the store supports all five kinds, ID reads, MIME/hash validation, export, and documented retain-on-remove behavior.

- [ ] **Step 2: Run focused tests and static checks**

Run: `npm test -- src/server/skills/artifacts/artifact-store.test.ts src/server/db/repositories/skill-package.repo.test.ts src/server/skills/runtime/skill-run-events.test.ts`

Expected: PASS.

Run: `npm run typecheck && npm run build`

Expected: both commands exit 0.

- [ ] **Step 3: Run full suite and diff check**

Run: `npm test`

Expected: PASS. If the known parallel LLM integration timeout occurs, immediately run `npm test -- src/server/llm/llm-runtime.integration.test.ts` and report both results.

Run: `git diff --check`

Expected: no whitespace errors.

## Coverage Review

- Per-run isolation, caller-controlled filename rejection, and `DATA_DIR` derivation: Tasks 1 and 2.
- Markdown, JSON, prompt, image reference, directory manifest, size/hash, MIME, and ID-based reads: Task 2.
- Renderer isolation from absolute paths, safe export, and retention policy: Task 3.
- TODO completion and comprehensive verification: Task 4.
