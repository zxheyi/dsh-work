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

Further entries record actual commands and results, not intended verification. Human usability, Windows and live-model evidence must remain explicitly pending until obtained.
