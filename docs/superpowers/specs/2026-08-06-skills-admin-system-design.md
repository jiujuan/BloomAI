# Design Spec: BloomAI Skills Admin System v1.1

## Approved direction

- Product: Skills Runtime Control Plane.
- Audience: administrator and operations control plane with filtered ordinary-user views.
- Terminology: UI uses **Workbench**, never Workspace.
- Visual language: current BloomAI warm-gray/light surface, existing brand gradient, compact bordered console controls, status colors, and Lucide-style line icons.
- Roles: exactly three — ordinary user, administrator, operations.
- Existing `docs/skills/ui/skill-management-console-v1.1.html` is unrelated and must not be modified.

## Deliverables

1. `docs/skills/skill-admin-system-v1.1-design.md` — complete page and interaction specification.
2. `docs/skills/ui/skill-admin-control-plane-v1.1.html` — standalone high-fidelity interactive prototype covering all approved pages.

## Page inventory

- Runtime Overview
- Package Catalog
- Package Detail
- Run Explorer
- Run Detail
- Approval Queue
- Capability Policies
- Artifact Center
- Creator / Draft Studio
- Legacy Skills
- Runtime Diagnostics
- Release & Migration
- Audit & Evidence

## Hard product invariants

- Run is bound to immutable Skill Version and content hash.
- requested capability is not granted capability.
- Capability execution enters through Capability Broker.
- disabled installation does not erase historical Run/Event/Artifact.
- database migration is forward-fix only.
- read-only mode preserves query/export and disables new execution/change operations.
- long-running state is durable and remains visible after reload.

## Role contract

### Ordinary user
Own-scope Skills, Runs, Events, Artifacts, capability requests, cancellations, and own Drafts.

### Administrator
Package/version/installation lifecycle, Creator review/publish, capability approvals/policies, global product data, Workbench visibility, Legacy management.

### Operations
Runtime health, queues, workers, diagnostics, artifact retention/orphan cleanup, release gate, migration dry-run, backup/restore rehearsal, application rollback, global audit/evidence.

No additional roles may be introduced in the prototype.

## Visual contract

- BloomAI light tokens: `#ffffff`, `#f5f5f4`, `#eeede9`, `#1a1a18`, `#3d3d3a`, `#73726c`.
- Brand gradient: `#7C6FF7 → #4B9BF5`.
- Status colors: success `#1D9E75`, running `#2563eb`, waiting `#EF9F27`, warning `#BA7517`, danger `#e5484d`, disabled `#73726c`, info `#534AB7`.
- Status always uses icon + text + color.
- Default compact spacing and 4/6/10/14px radii.
- Light/Dark toggle is included in prototype.

## Prototype interaction contract

- no build, backend, or network dependency;
- navigation switches all thirteen screens;
- role switch changes navigation, data scope, and enabled actions;
- drawers expose Package, Run, Approval, Artifact, and Migration detail;
- confirmation dialogs cover approve, reject, cancel, retry, pause new Run, dry-run, and rollback;
- loading, empty, waiting, failed, read-only, feature-disabled, and permission-denied states are demonstrable;
- no edits to existing untracked user files or existing skill management prototype.

## Review checklist

- [ ] Page inventory maps to v1.1 control-plane/runtime/capability/artifact/creator/legacy/operations responsibilities.
- [ ] Workbench terminology is consistent.
- [ ] Exactly three roles are represented.
- [ ] Permission boundaries do not imply frontend-only security enforcement.
- [ ] Status colors do not replace text or icons.
- [ ] High-risk capability approval cannot be represented as a one-click unrestricted grant.
- [ ] Rollback UI communicates that database migrations are not rolled back.
- [ ] Existing user files remain outside the change set.
