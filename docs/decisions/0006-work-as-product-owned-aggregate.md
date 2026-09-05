# 0006: Work as a product-owned aggregate over Harness Workspace and Session

Status: accepted

Date: 2026-09-01

Product direction note (2026-09-05): Required Work topology and completion/delivery semantics are superseded for new implementation by [ADR 0014](0014-familiar-conversations-and-versioned-files.md). This historical decision and its original evidence remain intact; ownership, file containment and request-correlation guarantees still apply.

## Problem

DSH Work needs a durable product object for the thing an ordinary user is trying to finish. DeepSeek Harness already provides Workspace, Session, Turn, Agent, tool, permission, Profile, Bundle, and plugin lifecycles, but none of those objects represents the complete user outcome.

Treating a Session as the Work would make a conversation ending, failing, forking, or being replaced look like the user's work ended. Treating a Workspace as the Work would make a local directory responsible for goals, review, deliverables, and delivery. Adding a second execution runtime would duplicate Harness and turn DSH Work into a divergent desktop product.

The product therefore needs an ownership boundary that preserves Harness semantics while allowing DSH Work to own goal-first navigation, reviewable deliverables, user acceptance, and delivery.

## Evidence

- `docs/product-scope.md` defines DSH Work as an independent desktop product built on public DeepSeek Harness seams. It forbids a parallel runtime, private upstream imports, and modification of upstream source.
- `docs/upstream-compatibility.md` locks the official alpha.2 CLI, Profile, Bundle, and public plugin boundaries used by the product.
- The pinned [Web Client architecture](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/docs/subsystems/web-client.md) defines Host service, Remote, Client model, and slot-based presentation layers that an external product plugin can compose.
- The pinned [external settings-card cookbook](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/docs/cookbook/adding-a-settings-card.md) records a current alpha.2 packaging risk: upstream does not publish an external `clientBundle(...)` preset, so a real Profile and Loader smoke is required for every DSH Work Web Client artifact.
- The pinned [Workspace package contract](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/workspace/workspace/README.md) defines Workspace as a host-only persistent set of named user directories with the Sessions that ran in them. It is invisible to the model and does not own user outcomes.
- The pinned [Session package contract](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/core/session/README.md) defines Session as the append-only source of truth for an Agent's whole interaction history. A Session contains Turn boundaries and can be forked only at a stable completed prefix.
- The pinned [deliverables UI contract](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/client/ui-deliverables/README.md) derives clickable produced-file rows from supported successful mutation calls. It is not a durable product model for deliverable identity, versions, review, acceptance, or export.
- The current positioning prototype tests a goal-first work surface in which users see a Work, sources, progress, review, and deliverables instead of configuring Harness objects.

## Decision

Introduce **Work** as a DSH Work-owned aggregate that references and orchestrates Harness-owned Workspace and Session objects without redefining them.

Harness remains the system of record for:

- Workspace registration and its local directory;
- Session identity, conversation history, Turns, Agent loop, tools, and permissions;
- Profile, Bundle, Loader, Host service, Remote, and Client plugin lifecycles.

DSH Work becomes the system of record for:

- `workId`, title, goal, creation and update metadata;
- `primaryWorkspaceId` and `primarySessionId` references;
- optional related Session links with a reason such as fork, parallel work, isolation, or another Workspace;
- source references or snapshots selected for the Work;
- deliverable identity, versions, provenance, review, acceptance, and delivery records;
- recoverable provisioning or mutation markers owned by the Work domain.

DSH Work must not copy canonical Session transcripts into the Work aggregate or mutate Harness persistence directly. It may retain product projections, links, and summaries needed to render the Work surface.

### Default topology

The first product slice uses this default:

`1 Work = 1 DSH Work-managed Workspace + 1 primary Session + many Turns + many deliverable versions`

Normal follow-up instructions and revisions continue in the primary Session as new Turns. Creating another Session is an explicit advanced operation for parallel work, a fork, isolation, a different preset, or work that truly requires another Workspace. Multi-Workspace Work is not an MVP assumption.

Files, webpages, pasted content, and imported data are Sources. Adding a Source does not create a Workspace. The managed Workspace is the Work's local working directory and may contain imported or generated files according to an explicit copy, snapshot, or reference policy.

### Independent state dimensions

Persist Work state as separate dimensions rather than one linear status:

- lifecycle: `open | completed | delivered | archived`;
- review: `not-ready | awaiting-review | changes-requested`;
- execution: derived from referenced Sessions and their current Turns as `idle | running | waiting-user | failed`.

The UI may combine these dimensions into labels such as “执行中” or “待审核”. A Session or Turn ending never completes a Work. Only user acceptance changes lifecycle to `completed`; a successful export or share after acceptance changes it to `delivered`.

### Plugin composition

Implement the aggregate as Harness-native DSH Work plugins:

1. A Host work-domain plugin persists Work records through public `ctx.storageDomain`.
2. A Work controller uses public `ctx.workspaceRegistry` and `ctx.sessionController` to resolve or create referenced Harness objects.
3. A Remote and Client model expose product-safe state and mutations to the Web Client.
4. A Web Client plugin contributes the Work surface through the official Loader and slot model.
5. A deliverable module owns DSH Work artifact references, versions, review, and export semantics.
6. Electron stays a thin secure host and does not become the Work database or orchestration runtime.

The first external interface should stay narrow:

- `work.create(spec)`
- `work.dispatch({ workId, command })`
- `work.list()`
- `work.follow()`

### Recoverable creation

Harness storage domains do not provide a cross-domain transaction spanning Work, Workspace, and Session. Work creation must therefore be idempotent and recoverable:

1. Allocate `workId`, `sessionId`, and the managed directory.
2. Persist a provisioning record or pending mutation.
3. Create or resolve the Workspace idempotently.
4. Create or adopt the Session with the explicit ID and `workspaceId`.
5. Finalize the Work references.
6. Submit the initial goal as the first Turn.

A restart must either resume the pending operation or expose a stable recovery action. It must not silently create duplicate Workspaces or Sessions.

## Acceptance and verification

- [ ] A domain test proves that ending or failing a Turn does not complete or delete its Work.
- [ ] A domain test proves that a normal revision appends a Turn to the primary Session and preserves its `sessionId`.
- [ ] A domain test proves that user acceptance and delivery update independent Work lifecycle state.
- [ ] A domain test proves that adding a Source does not create another Workspace.
- [ ] A recovery test interrupts creation after each provisioning step and resumes without duplicate Work, Workspace, or Session records.
- [ ] A public-contract test proves the Host plugin uses only supported storage, Workspace, Session, Remote, and Loader seams.
- [ ] A real alpha.2 Profile and Loader smoke proves the external Web Client artifact loads through the official graph.
- [ ] An Electron E2E proves the desktop remains a thin host and that Work state survives a runtime restart.
- [ ] Upstream byte-integrity and compatibility gates remain green.

Implementation is not claimed by this accepted decision. Change the status to `implemented` only after these checks pass on every platform required by the active milestone.

## Alternatives considered

### Rename or decorate Session as Work

This would minimize new persistence, but it couples a user outcome to one conversation thread. Forks, parallel work, another Workspace, acceptance, delivery, and long-lived deliverable versions would either distort Session semantics or require unrelated metadata inside Harness-owned records.

### Use Workspace as the top-level product object

A local directory is a useful working anchor but cannot express user acceptance, review, delivery, or multiple related Sessions without becoming a second product database hidden inside Workspace metadata. It would also expose setup concepts before the user can state a goal.

### Build Work only in Electron

Electron-local state could prototype navigation quickly, but Host and Web clients would not share an authoritative model, headless use would be impossible, and lifecycle recovery would be coupled to a renderer or desktop process. This conflicts with the accepted thin-host boundary.

### Fork Harness or add a new upstream runtime object

An upstream Work primitive might eventually be useful, but DSH Work can compose the current public services without changing Agent execution. Forking would add permanent compatibility and maintenance cost before product validation justifies it.

### Start with a multi-Workspace aggregate

This appears flexible but makes directory ownership, permissions, relative paths, imports, and Session placement ambiguous in the first slice. The MVP instead uses one managed Workspace and models external inputs as Sources. Related Sessions or Workspaces can be added later with explicit semantics.

## Consequences

- DSH Work gains a small product-owned persistence and orchestration layer.
- Work creation requires a recovery protocol because persistence changes span multiple owners.
- UI copy can stay outcome-oriented while diagnostics preserve exact Harness IDs and states.
- A Work can survive Session completion, failure, restart, or an explicit related Session.
- Deliverable versioning and Office import/export remain DSH Work responsibilities; built-in produced-file rows are only an integration input.
- Rich in-app Office editing is still a separate capability and must not be implied by this aggregate.
- The external Web Client build shape is coupled to the pinned Harness alpha and requires a real Loader smoke on pin changes.
- Multi-Workspace behavior, collaboration, scheduling, and project management remain later decisions.

## Rollback or supersession

Before persisted Work data ships, rollback by removing the DSH Work domain and Client plugins while retaining the official Harness surface. After persisted Work data ships, supersede this record with an explicit migration that maps every Work reference and deliverable record without deleting Harness Workspace or Session data.

Reconsider the aggregate boundary if upstream introduces a stable first-class Work object that covers goal, review, deliverables, acceptance, and recovery, or if product validation shows users do not benefit from a durable outcome above Session.
