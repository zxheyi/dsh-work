# Familiar Work v5 implementation issue

Status: authorized local implementation, 2026-09-05

## Outcome and authority

The product owner asked to implement the ordered plan and create an independent commit for each slice. This local issue records scope and evidence without publishing to an external tracker. Changes stack on the existing feature branch as requested; each commit must remain independently reviewable. No push, release or external publication is implied.

## Sources and boundaries

- [Requirement fact source](../design/familiar-v5/requirements.json), R01-R18.
- [Design baseline](../design/familiar-v5/README.md), four target screens.
- [Acceptance](../acceptance/familiar-work-v5.md), including failure/recovery/security paths.
- [Decision](../decisions/0014-familiar-conversations-and-versioned-files.md).
- [Task details and dependencies](familiar-v5-tasks.json).

Work starts at revision `60812cc`. Existing untracked `docs/deepseek-harness-surface-context-research.md` is unrelated and remains untouched. Native ownership, read-only upstream, lifecycle/security and managed path constraints remain mandatory.

## Ordered slices

| ID | User outcome | Dependencies | PRD |
| --- | --- | --- | --- |
| T01 | 同步新产品契约与旧数据兼容方案 | - | R02, R03, R04, R11, R12, R16 |
| T02 | 恢复原生两栏会话壳并验证插件组合 | T01 | R03, R04 |
| T03 | 首次连接与普通聊天贯通 | T02 | R01, R04 |
| T04 | 在工作区内创建多条会话 | T02 | R02, R16 |
| T05 | 会话切换、搜索与归档准确生效 | T04 | R02, R03 |
| T06 | 在原输入框导入资料并发送 | T03, T05 | R05 |
| T07 | 在会话内处理权限请求 | T03, T05 | R13 |
| T08 | 生成真实文件并显示成果入口 | T06, T07 | R06 |
| T09 | 在右侧安全阅读 Markdown | T08 | R07, R17 |
| T10 | 显示资料来源与文件分组 | T06, T09 | R08 |
| T11 | 同会话修改，并保留上一有效结果 | T09 | R09, R14 |
| T12 | 无需采用即可保存当前文件副本 | T09, T11 | R12 |
| T13 | 运行时故障后回到原会话 | T05, T11, T12 | R14 |
| T14 | 窄窗口、键盘与会话文件闭环验收 | T03, T05, T07, T10, T12, T13 | R03, R17 |
| T15 | 为成功生成保存不可变版本 | T01, T08, T11 | R10 |
| T16 | 查看历史版本并指定旧版修改 | T09, T15 | R09, R10 |
| T17 | 在文件面板比较两个版本 | T16 | R10 |
| T18 | 恢复旧版时创建新版本 | T15, T16 | R10 |
| T19 | 采用绑定到具体文件版本 | T15, T16 | R11 |
| T20 | 保存任意选定版本并核对记录 | T12, T16, T19 | R12 |
| T21 | 处理跨会话与外部文件修改冲突 | T15, T18, T20 | R10, R14 |
| T22 | 按四张设计图完成整体验收 | T14, T17, T18, T19, T20, T21 | R01, R02, R03, R04, R05, R06, R07, R08, R09, R10, R11, R12, R13, R14, R17 |
| D01 | 完整旧 Work 数据迁移与回滚 | T22 | R16 |
| D02 | 原生另存为及双平台桌面发布 | D01 | R15 |
| D03 | 按真实需求逐格式扩展 | T22 | R18 |

T01-T22 cover the main product implementation. D01-D03 remain follow-on epics from the accepted plan; split their bounded outcomes before implementation. Every dependency must have evidence before the dependent behavior is declared complete. Runtime upgrades remain separate if ever required.

## Evidence ledger

### T01 Product contract synchronization

- Added a frozen in-repository PRD requirement/design baseline, accepted successor decision, old/new semantic map, compatibility constraints and per-slice acceptance tracking.
- Product owner authorization is the accepted direction; implementation and migration are not claimed complete by the decision.
- Verification: `node --test scripts/verify-contract.test.mjs` passed 12/12; `node scripts/verify-contract.mjs` passed; all new Markdown links and R01-R18 task mappings checked. Independent read-only review found and corrected the ADR index table boundary and the T02/T04 legacy-access dependency.
- Release notes: product direction and implementation plan only; no runtime behavior changed.

### T02 Native conversation shell

- Removed the Work plugin's full `sidebar` and `conversation` takeovers. The locked alpha.2 sidebar, Workspace/Session browser, conversation, composer, model controls and settings now retain their native owners.
- DSH Work uses the official `sidebar.brand.*` extension seats. T04 maps existing Work records into native Workspace/Session navigation and replaces the temporary full “旧版工作” overlay with a bounded “旧成果” reader for files that have not yet moved to the native file panel.
- Added the already locked alpha.2 sidebar package as an explicit type/load-order dependency. It adds no new version, license or runtime family; rollback removes the fine-grained registrations and direct declaration together.
- Verification: Work Client bundle and frozen dependency tests passed 2/2; TypeScript passed; real alpha.2 Loader/Profile/runtime integration passed 11/11; 1440×900 Work UI acceptance passed; authenticated desktop Shell E2E passed with sandbox, navigation and clean-stop assertions.
- First-run alpha.2 still presents its native internal-testing/model onboarding. T03 owns the exact missing-model and draft-preservation behavior; T02 does not claim credentials or a live model were verified.

### T03 First connection and ordinary conversation

- Kept production routing inside the locked Harness model directory, per-Session model projection and native composer. DSH Work adds no credential store, provider picker or duplicate message path.
- Added an isolated test Profile bundle that registers a public `LlmAdapter`, two advertised models and one fixed Workspace/Session only inside disposable acceptance homes. The production Profile and shipped bundles do not load this fixture.
- The two-phase desktop acceptance proves that an unroutable default locks both Enter and Send with native guidance. In one connected Profile and Session, withdrawing the selected route locks a populated composer without submitting, reloading through the native setup prompt preserves the draft, and restoring the route unlocks that same draft. Changing to the second catalog model also preserves it.
- After reconnection, two prompts and responses remain in that durable Session. The native Stop action must abort a deliberately delayed third model request within three seconds; waiting for the fixture to finish cannot satisfy the check.
- The connected ordinary-chat flow leaves the Workspace empty and renders no Markdown result or delivery action. The selected model is read from the real Host model catalog rather than a client constant.
- Verification: `pnpm typecheck`, `pnpm test` (130/130) and `pnpm check` passed; `DSH_WORK_NODE=<locked-node> pnpm test:conversation` passed both missing and connected phases, including the plain-JSONL test-only persistence record. Screenshots are written to ignored `artifacts/conversation/` for local review.

### T04 Multiple Sessions inside one Workspace

- Added an explicit idempotent `WorkController.initialize()` boundary and await it before publishing the Host service. A stored Work now re-registers its existing Workspace path and Primary Session through public Harness services before native clients can navigate it.
- Removed the temporary legacy Work homepage and its duplicate goal/navigation flow. Old Work IDs, Workspace IDs, Session IDs and files remain unchanged; the mapped Session appears in the native Workspace tree. A bounded “旧成果” action keeps an existing Work deliverable readable, and a delivered Work can still reveal its export location until T09/T12 replace this compatibility path.
- Native new-conversation behavior remains owned by the upstream Workspace/Session services. The real desktop acceptance clicks the Workspace row's native new-Session action, sends a turn through the native composer, and observes the resulting distinct Session in the same directory without creating another Work or Workspace.
- The create phase freezes Work, Workspace, primary Session, UI-created Session, path, prompt and file-byte evidence. The restore fixture only reads and compares that baseline; it cannot recreate a Session, sentinel file or identity before the UI proves both original Sessions are present after restart.
- Empty Profiles retain both native “选择工作区” and “添加工作区” entries. Resource verification also proves adding a file to the existing Work does not call Workspace creation again.
- Verification: `pnpm typecheck`, `pnpm test` (131/131) and `pnpm check` passed; `DSH_WORK_NODE=<locked-node> pnpm test:workspace-sessions` passed empty, create and restore phases. The desktop evidence confirms one Workspace row, two distinct Session IDs, unchanged legacy bytes, no legacy homepage, and the bounded legacy deliverable preview.

### T05 Session selection, search and archive

- Kept selection, per-Session drafts, search, archive membership and navigation inside the locked alpha.2 Workspace/Session client. DSH Work adds no parallel selected-Session state and no Session persistence copy.
- Added a disposable real-Host fixture with two Sessions, distinct prompts, responses and durable records in one Workspace. The desktop acceptance switches both directions, proves each conversation excludes the other's messages, and proves each unsent draft returns only with its owning Session.
- Native title search locates and opens the intended Session. The minimal fixture Profile reports Host content search as unavailable and the UI exposes its built-in name-only fallback; this slice does not claim content search passed. A separate no-match step captures the explicit empty state and exits through the native clear action.
- Archiving the selected Session is observed from the Host Workspace registry. Its persisted Session records still contain both original messages, and both pre-existing Workspace files retain their original byte digests while the archived row leaves the active tree.
- Verification: `pnpm typecheck` passed; `DSH_WORK_NODE=<locked-node> pnpm test:session-navigation` passed selection isolation, per-Session drafts, title search/open, no-result exit and archive preservation. Screenshots are written to ignored `artifacts/session-navigation/`.

### T06 Import resources through the native composer

- Added a compact “资料” action to the native composer plus document drop handling. Markdown, UTF-8 text, CSV and valid JSON show copying, ready and retryable failure states; failed or ready items can be removed before sending.
- The Host resolves the addressed Session through the public Session controller, copies bytes to a Session-separated attachment name in that Session Workspace, and returns only a relative file reference. Safe reference-compatible names, canonical base64, the 25 MiB limit, UTF-8 content, JSON syntax and resolved Workspace containment are checked before the file is treated as readable. Exclusive no-follow file handles prevent an existing link or non-regular target from being read or overwritten. Selecting a file never writes to its source.
- Copy publication uses a hidden, random pending file and a no-overwrite hard link. Pending files are deliberately retained because unlinking a path after a Workspace replacement cannot prove object identity atomically; successful first publication adds only another link to the same inode, while an existing-target retry can retain another full pending copy. Safe maintenance cleanup remains follow-on work and this version does not claim automatic reclamation.
- A successful copy appends the native `@path` grammar to that Session's existing draft. Pending resources and drafts remain isolated while switching between Sessions, return with their owning Session, and clear after the native request consumes the draft. Copy completion is described as “已复制，发送后读取”; it does not claim the model understood the file before submission.
- Verification: `pnpm test` passed 135/135 and `pnpm check` passed. `DSH_WORK_NODE=<locked-node> pnpm test:session-resource` passed unsupported-format feedback/removal, mixed document/image drop routing, copying-state send blocking, in-flight removal, managed-byte copy, two-way Session isolation, pending-state restoration and model receipt of the referenced path. `DSH_WORK_NODE=<locked-node> pnpm test:session-navigation` passed the T05 navigation regression.

### T07 Handle permission requests in the current Session

- Kept Harness as the sole approval owner: an `ask` decision is recorded through its public `approval/asked` and `approval/decided` events, while the existing native approval contribution takes over the composer with operation reason, “允许一次” and “拒绝”. DSH Work only aligns the native card border, radius and type with its surrounding shell.
- The one-shot grant executes only the correlated tool call. A second restricted call asks again; rejection returns a tool failure, does not execute the body, and does not retry that call. Switching Sessions while a request waits preserves the owning approval and the other Session draft.
- Verification: `pnpm check` passed. `DSH_WORK_NODE=<locked-node> pnpm test:session-permission` passed allow-once execution, second-request rejection, exact two-pair approval audit, Session-scoped pending restoration, retained draft and files, composer restoration and ordinary chat after rejection. The native permission screenshot is written to ignored `artifacts/session-permission/permission.png`.

### T08 Register real files as Session outputs

- Added a Turn-tail contribution to the native conversation. It claims the existing output row and asks the Host to revalidate the selected Session, closing Turn and sequence before rendering any card. A prose-only answer renders no output row. Each card title comes from the actual produced path, and selecting a card publishes the exact Session, Turn and path for the T09 preview surface.
- Output discovery follows successful append-origin `write`, `edit` and mutating `str_replace_editor` tool results. It preserves first-seen order, de-duplicates repeated edits and ignores other tools, failed results, later sequence numbers, older Turns and other Sessions. A completed Turn is required before any candidate can be shown.
- The Host resolves the real Session Workspace and opens each candidate through a no-follow file handle. Missing paths, empty files, directories, linked-out paths, absolute or relative escapes and path identities changed during validation are omitted. This slice reads metadata only; immutable version capture remains owned by T15.
- Verification: `pnpm test` passed 139/139 and `pnpm check` passed. `DSH_WORK_NODE=<locked-node> pnpm test:session-output` passed ordinary-reply exclusion, a real output in a second Session, two independently selected files in the current Session, empty-file exclusion, native-row replacement and retention on the original Turn. The screenshot is written to ignored `artifacts/session-output/files.png`.

### T09 Read Markdown safely beside the conversation

- Added an on-demand Session-output read through the Domain, Remote and Client boundaries. The Host revalidates the exact Session, Turn, sequence and produced path, then reads a non-empty UTF-8 Markdown file through a no-follow handle capped at 5 MiB + 1 byte. The list and follow stream continue to carry metadata only.
- Clicking an output opens the native `details` column beside the conversation. The panel shows the real file name, generating Turn, size, headings, paragraphs, lists and fenced code. Closing restores focus to the file card and preserves the original composer draft. Unsupported formats keep their metadata and offer the real native open action.
- Markdown is parsed into a closed block model and fixed React elements. Source HTML, scripts, links, images and iframes are never injected as DOM or fetched. Structurally dense content falls back to one plain-text node instead of creating an unbounded React tree. Each selection owns a latest-request generation, so a late read or failure from the previous file cannot overwrite the current preview; missing files expose a retry action.
- Verification: `pnpm test` passed 146/146 and `pnpm check` passed. `DSH_WORK_NODE=<locked-node> pnpm test:session-output` passed retry after a temporarily missing file, safe structured Markdown rendering, script/external-resource negative checks, CSV fallback, file switching, full right-column expansion, native Tool inspection handoff to Trajectory and back, close-to-card focus and composer-draft retention. The review screenshot is written to ignored `artifacts/session-output/preview.png`.

### T10 Trace source files beside generated results

- Split each completed file-producing Turn into “资料” and “生成结果” groups. A source is admitted only when the native user message contains the exact managed `@attachment…` reference or the same Turn has a successful `read` Tool result for that path. Prose file names and arbitrary paths are ignored, and a path successfully mutated in that Turn is excluded from the source group.
- Reopened managed snapshots are checked through no-follow file handles against their Session key, content-digest prefix, file identity, size and timestamps. The UI reports verified reads, references that were not read, missing files, changed bytes and inaccessible paths as distinct states. It does not calculate a trust score or claim that a reference supports a particular sentence.
- The output preview now exposes a real “来源” tab for Markdown and other output formats. It shows the Workspace snapshot path and byte size, and can place the exact source reference back into the existing native composer. Source inspection failure is reported independently without hiding valid generated files.
- Verification: `pnpm test` passed 151/151 and `pnpm check` passed. `DSH_WORK_NODE=<locked-node> pnpm test:session-output` passed native resource import, successful `read`, source/result grouping, Markdown and CSV source-tab inspection, exact composer reference restoration, Session isolation and prior preview safety checks. The source review screenshot is written to ignored `artifacts/session-output/sources.png`. Domain integration covers verified, unverified, missing, changed and inaccessible snapshots; prior-Turn carryover, path aliases, both Workspace-root replacement windows, oversized fabricated references and duplicate-output exclusion are negative checks.

### T13 Return to the original Session after Runtime failure

- The desktop shell retains one strict, bounded recovery record containing only the current Session id, unsent draft and exact output coordinates. The narrow preload bridge is available only to the validated loopback main frame; the status page receives only a boolean indicating that context exists.
- A reusable-generation Runtime failure opens the read-only status surface. Runtime-dependent Work writes fail before any remote call, while restarting the same generation opens the retained Session through the native Session service, restores an empty composer draft and reopens a file only after its Session, Turn, sequence, path, name, size and media type still match Host validation.
- Recovery never resubmits a Turn or creates a Session. A complete Session list that does not contain the retained id invalidates the record, so Guardian isolated recovery can proceed in a new generation without leaking stale context. Uncertain generations still require explicit isolated recovery; durable immutable file bytes remain T15 scope.
- Verification: `pnpm test` passed 165/165 and `pnpm check` passed. `DSH_WORK_NODE=<locked-node> pnpm test:runtime-context` used the real Guardian and official CLI, generated and opened `report-a.md`, stopped the Runtime, injected a launcher failure, restarted the same generation, and proved the same Session, draft, Turn count, conversation count and readable Markdown returned without replay. `DSH_WORK_NODE=<locked-node> pnpm test:desktop -- --mode runtime-recovery` passed the distinct-generation quarantine regression. Independent review confirmed the same-generation recovery and T15 boundary after stale pending context was invalidated on a complete missing-Session baseline.

### T14 Narrow-window, keyboard and Session-file flow acceptance

- At widths up to 995px, selecting an output opens one viewport-sized review panel with a named “返回会话” control. Opening moves focus to that control; Escape closes the panel, returns focus to the native composer and preserves its draft. The desktop details-column behavior and file-card focus return remain unchanged at wider widths.
- Every current preview action has an accessible name. Tab is contained within the narrow review panel and reaches content, sources, save-copy and revision actions before returning to the close control. Revision and source-reference actions return to the composer after they add their exact file reference. Save and source states expose live text status semantics instead of relying on color.
- The real Session-output desktop acceptance completes import, generation, source inspection, revision and save-copy before testing trusted keyboard input at 736px and 390px. It asserts viewport containment, action overflow, accessible names, focus order, status semantics, Escape return and draft preservation, and records both responsive screenshots under ignored local artifacts.
- Verification: `pnpm typecheck` passed; `DSH_WORK_NODE=<locked-node> pnpm test:session-output` passed the complete file flow and responsive keyboard assertions. F13 remains pending until five existing DSH users are observed using the same revision; the [observation record](../acceptance/familiar-work-v5-usability-observation.md) deliberately contains no synthetic participant result.

### T15 Preserve immutable versions for successful output generations

- Added the accepted `session-output-versions/v1` journal outside Harness Session persistence, live Workspace files, managed save copies and the legacy Work aggregate. A stable file id binds one Session to one normalized path; a stable version id binds that file to one completed Turn boundary. Each immutable record freezes its ordinal, byte count, digest, media type, creation time and verified source metadata.
- Publication writes one bounded transaction capsule, then a content-addressed blob and metadata record through exclusive no-overwrite links. A randomized confirmation file makes the record readable only after its exact digest and parent identity pass; interruption or replacement can leave an unconfirmed record but cannot expose it as history. Restart recovery completes and confirms the frozen capsule without consulting changed Workspace bytes. Directory identity, no-follow reads, digest checks and strict parsing reject replacement, symlink and conflicting-byte cases. Pending hard links and completed capsules stay inert because deleting a path after parent replacement cannot prove its identity.
- Versions publish only while the completed Turn is the latest Session event, rechecked against a fresh Harness inspection after byte and source capture. The unique completion-event sequence normalizes retries that carry different inspection boundaries. Full-content write/create arguments must match captured bytes when available, so delayed first inspection cannot assign a later overwrite to an earlier Turn. Failed, incomplete, empty, missing and invalid outputs create no version. A retained legacy Work deliverable may create one explicit migration baseline through the same bounded, fixed-handle identity checks, without inventing Turn history. The 513th version is rejected before publication while the first 512 remain readable.
- Added strict Domain, Remote and Client list/read contracts for T16. The existing Session-output Electron acceptance now proves the first report and CSV create immutable blobs with frozen source evidence, the failed empty revision adds no record, and the successful retry adds ordinal 2 while ordinal 1 remains byte-identical.
- Verification: targeted Domain tests passed 60/60 and `pnpm test` passed 180/180, covering capsule/blob/record interruption, pre-publication pending files, live-frontier changes, directory replacement before write and at the final link, recovery guards, legacy capture replacement, same-Turn retry normalization and the 512-record limit. `DSH_WORK_NODE=<locked-node> pnpm test:session-output` passed the real alpha.2 Session generation and revision flow and required a matching confirmation digest before accepting each journal record. The protocol deliberately makes no full power-loss durability claim for directory entries.

### T16 View history and revise from a selected version

- Added the familiar third “版本” tab to the existing file panel. It lists only confirmed immutable records, marks the latest valid record as current, shows stored Turn, local rendering of the stored creation instant, byte size and digest, and derives the summary from the selected snapshot’s first meaningful line. Selecting v1 or v2 reads that exact blob through the existing strict API; a latest-request guard prevents an older asynchronous read from replacing a newer selection.
- “基于 vN 修改” validates that the selected file/version belongs to the same Session and normalized output path, copies its verified bytes to a content-addressed Session Workspace attachment, and inserts both that snapshot reference and the live target reference into the original native composer. The live file stays unchanged and its latest valid bytes remain protected by the existing revision recovery flow. Cross-Session version identities, unreadable blobs and conflicting managed attachment bytes fail closed.
- Verification: `pnpm check` and `pnpm test` passed 184/184. Controlled interleaving checks reject stale version content and late revision callbacks, invalid version identities fail before Session or journal I/O, and dense Markdown summary extraction stays allocation-bounded. `DSH_WORK_NODE=<locked-node> pnpm test:session-output` passed the real Electron flow: v1/v2 appeared together, v1 rendered its exact old content and traceable summary, the live v2 file stayed unchanged, the composer received an exact v1 Workspace snapshot plus `@report-a.md`, both immutable records remained readable, and the added tab stayed inside the 736px/390px keyboard focus loop. The screenshot is written to ignored `artifacts/session-output/versions.png`.

### T17 Compare two versions in the file panel

- Added a deterministic line comparison inside the existing version panel. The controls default from the prior snapshot to the latest snapshot and allow either direction or the same version. Removed and added blocks carry `−/删除` and `+/新增` labels as well as distinct colors; unchanged content has an explicit no-change result. Every displayed line remains React text, so Markdown HTML and remote-looking resources cannot execute.
- Comparison first bounds both inputs to 512 KiB, 2,000 lines and 250,000 LCS cells. Larger or denser files return a clear line-count summary without allocating a diff matrix. Current-file bytes and the selected reading version are never written by comparison. Asynchronous pairs are committed only when both returned version identities still match the active selectors.
- Verification: `pnpm check` and `pnpm test` passed 186/186; deterministic tests cover old-to-new direction, same-content output, HTML-shaped text, line-density and character-size fallback. `DSH_WORK_NODE=<locked-node> pnpm test:session-output` passed real v1→v2, v1→v1 and v2→v1 comparisons against immutable blobs, retained the v2 live file, and recorded the comparison in ignored `artifacts/session-output/versions.png`.

### T18 Restore an old version as a new version

- Added “恢复 vN” beside the existing version-based revision action. Preparation validates that the selected immutable version belongs to the same Session and normalized file, verifies the live Workspace file still matches the latest confirmed version, copies the selected snapshot into that Session, and places an exact restore request in the original native composer. Existing Workspace changes stop preparation with a refresh-and-retry conflict message.
- A restore remains a normal same-Session Turn. Its completed Markdown must match the selected snapshot digest before revision protection succeeds; only then does the immutable publisher add the next ordinal. The persisted Session request names the content-addressed snapshot and exact live target, so restart validation can reconstruct the required immutable digest and reject a wrong completed write even after in-memory protection is lost. A failed attempt leaves the version journal unchanged; repeated inspection stays idempotent.
- Verification: `pnpm check` and `pnpm test` passed 187/187. Domain integration covers pending-target replacement rejection, an invalid nonempty restore, retry from recognized failed bytes, restart before inspection, one v3 whose digest equals v1, preserved readable v2, repeated publication inspection, external Workspace drift rejection and an output-parent replacement after the file handle opens. `DSH_WORK_NODE=<locked-node> pnpm test:session-output` passed the real Electron v1→v3 restore, immutable snapshot binding, preparation retry, v2 retention, current-version update and explicit external-edit conflict. The version evidence remains in ignored `artifacts/session-output/versions.png`.

### T19 Adopt a specific file version

- Added a persistent adoption record beside the immutable version journal. The record binds one file id and version id to its Session, normalized path, SHA-256 digest, server-derived content summary and adoption time. Adoption first re-reads and verifies the immutable record and blob, is idempotent for the same version, and never changes the Work status or the Session lifecycle. A separate randomized digest confirmation makes an adoption visible only after its complete record is durable; an interrupted unconfirmed record can be confirmed by an exact retry, while a directory-replacement result remains invisible.
- Version list and content reads attach only the adoption belonging to that exact version. The native version row now distinguishes “当前版” from “已采用”; adopting v1 leaves a later v2 or restored v3 unadopted, while v1 keeps its marker and summary. The adopted version remains available after ordinary explanation Turns, same-Session revision, another Session using the same file name and controller restart.
- Verification: `pnpm check` and `pnpm test` passed 191/191. Domain integration covers immutable-coordinate and digest binding, derived summary, duplicate adoption, explanation without cancellation, adopt-then-revise, later-version isolation, cross-Session isolation, restart persistence, directory replacement, interruption before confirmation, dense line input and the bounded pending-attempt limit. `DSH_WORK_NODE=<locked-node> pnpm test:session-output` passed v1 adoption, exact persisted record checks, visible current/adopted markers, v3 non-inheritance and continued same-Session restore/revision. Evidence remains in ignored `artifacts/session-output/versions.png`.

### T20 Save any selected file version

- Extended the existing managed-copy operation with an optional immutable version coordinate. The Host resolves and verifies the selected confirmed record and content blob under the version journal lock, then freezes those bytes before entering the save transaction. A later live-file write, visible-version switch or background generation cannot change the saved object. Ordinary current-file saves retain their existing behavior.
- Every successful version copy records the exact file id, version id and ordinal beside its real managed location and digest. Version identity is part of save identity, so two immutable versions with equal bytes still produce independent records and locations. Adoption remains a separate state and an unadopted older version can be saved.
- The version panel labels the action and all pending, success, uncertain and retry states with the selected ordinal. A failed response retains the original target for explicit retry even if the visible selection changes. Existing target names are never overwritten; an exact retry either returns the confirmed record or publishes a new non-conflicting attempt after a changed target is detected.
- Verification: `pnpm check`, `pnpm test` (193/193) and `git diff --check` passed. Domain integration freezes v1 while the live file advances, checks exact exported bytes/digest/version association, rejects cross-Session coordinates and preserves a conflicting prior file. Remote and client tests cover the strict optional version contract. `DSH_WORK_NODE=<locked-node> pnpm test:session-output` passed the real Electron v1 save while v2 stayed current and verified the distinct managed copy against the immutable v1 bytes. Independent review passed the retained-version retry regression (15/15) after the uncertain-result wording was restored.

### T21 Detect cross-Session and external file conflicts

- Every file revision now carries a strict lease bound to the real Workspace path, normalized output path, expected SHA-256 baseline and the Session event frontier at preparation. The Host accepts generated bytes only while that baseline remains current, freezes the accepted bytes before publication and advances the shared file head atomically. A second Session or external editor therefore cannot make a stale request publish or relabel another request's bytes.
- Revision leases cross the Remote and Client boundaries and survive full Renderer and Host reconstruction in the bounded desktop recovery context. The recovery record keeps up to eight Session-scoped leases without eviction and stores the latest preparation Turn, so an old failed Turn cannot settle a retried request. The preload and read-only status surface use the same 64 KiB boundary as the codec. A revision reference enters the sendable composer only after its new lease is retained; an over-capacity recovery record produces an explicit shorten-draft error.
- A conflict leaves its lease retained so another reconstruction continues to reject the stale Turn. The user must refresh and explicitly prepare the revision again, which replaces the lease with a new baseline and frontier. Invalid-output failures and successful publication settle only their matching path. Immutable adoption and selected-version saves continue to verify their exact stored version records and digests independently.
- Verification: `pnpm check`, `pnpm test` (197/197) and `git diff --check` passed. Domain integration covers external edits, two Sessions prepared from the same baseline, winner/loser ordering, frozen accepted bytes, Host reconstruction, failed-revision retries, exact refreshed retry, idempotent version publication and save. Remote, Client and recovery-codec tests cover strict leases, old-Turn filtering, legacy recovery records, duplicate rejection, rejected-Turn retention and the eight-lease cap. Real Electron Session-output and Runtime-context acceptance passed with the locked Node runtime. Independent review found and verified fixes for cross-request byte capture, rebuilt-Host fail-closed behavior, retry frontiers, bridge bounds, recovery-capacity gating and retained conflict evidence.

Further entries record actual commands and results, not intended verification. Human usability, Windows and live-model evidence must remain explicitly pending until obtained.
