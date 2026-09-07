# Familiar Work v5 evidence

Status: refreshed automated macOS acceptance passed on 2026-09-07; F13 human observation remains pending. The run started from `65ddccb` with the recovery-history readiness fix recorded by the source digests in this evidence commit.

This record compares the four frozen product designs with real Electron surfaces and maps every PRD scenario to executable evidence. The actual UI keeps the locked DSH native sidebar, conversation, composer, approval card and tool activity. Visual acceptance checks the intended composition, hierarchy and behavior rather than replacing those native controls with the concept-image pixels.

## Four design states

| Design | Frozen actual surface | Review result |
| --- | --- | --- |
| [New conversation](../design/familiar-v5/01-new-conversation.png) | [Actual conversation](familiar-v5-evidence/01-new-conversation.png) | Native two-column Workspace/Session navigation and one composer remain; ordinary follow-up stays in the selected Session. |
| [Permission](../design/familiar-v5/02-permission.png) | [Actual permission](familiar-v5-evidence/02-permission.png) | The native approval card remains inside the owning conversation and exposes purpose, allow once and reject. |
| [File review](../design/familiar-v5/03-file-review.png) | [Actual file review](familiar-v5-evidence/03-file-review.png) | A validated file opens beside the conversation with content/source/version tabs and independent save/revision actions. |
| [Version comparison](../design/familiar-v5/04-version-comparison.png) | [Actual version comparison](familiar-v5-evidence/04-version-comparison.png) | Real v1-v3 records expose selected/current/adopted state, deterministic comparison, restore, save, adopt and version-based revision. |

The actual permission card follows the native bottom-composer takeover instead of the concept image's centered card. The actual file panel uses the available desktop details column and keeps the upstream conversation header. These are intended native-layout differences; the PRD behavior and action ownership match.

## Required supplemental states

| State | Evidence | Observable result |
| --- | --- | --- |
| Model unavailable | [Screenshot](familiar-v5-evidence/05-model-unavailable.png) | Native composer is blocked with model guidance; Enter creates no Turn. |
| Generation in progress | [Screenshot](familiar-v5-evidence/06-generation.png) | The same composer exposes its native Stop action during an active model request. |
| Empty Workspace | [Screenshot](familiar-v5-evidence/07-empty-workspace.png) | Native choose/add Workspace entries remain available without a duplicate Work form. |
| Search has no results | [Screenshot](familiar-v5-evidence/08-search-no-results.png) | The empty result is explicit and has a tested exit path. |
| Permission denied | [Screenshot](familiar-v5-evidence/09-permission-denied.png) | The restricted action does not run and the original Session can continue. |
| Revision failed | [Screenshot](familiar-v5-evidence/10-revision-failure.png) | No false version is published; the prior valid result stays readable and retryable. |
| Runtime restored | [Screenshot](familiar-v5-evidence/11-runtime-restored.png) | Restart returns to the same Session, draft and selected file without replay. |
| 736px review | [Screenshot](familiar-v5-evidence/12-responsive-736.png) | The file review becomes a returnable single panel with a contained keyboard path. |
| 390px review | [Screenshot](familiar-v5-evidence/13-responsive-390.png) | Primary review actions remain reachable and returning preserves the draft. |
| 736px versions | [Screenshot](familiar-v5-evidence/14-responsive-versions-736.png) | Version comparison and all four version actions stay inside the returnable panel. |
| 390px versions | [Screenshot](familiar-v5-evidence/15-responsive-versions-390.png) | Comparison controls and the two-by-two action grid remain readable without horizontal overflow. |

## Scenario and criterion result

| PRD scenario | Automated result | Primary command |
| --- | --- | --- |
| Initial connection | Passed | `pnpm test:conversation` |
| Ordinary conversation | Passed | `pnpm test:conversation`, `pnpm test:workspace-sessions`, `pnpm test:session-navigation` |
| Attachment and generation | Passed | `pnpm test:session-resource`, `pnpm test:session-output` |
| File reading | Passed | `pnpm test:session-output` |
| Revision and versions | Passed | `pnpm test:session-output` |
| Adoption and save | Passed | `pnpm test:session-output` |
| Permission | Passed | `pnpm test:session-permission` |
| Revision/runtime failure | Passed | `pnpm test:session-output`, `pnpm test:runtime-context` |

F1-F12 have automated evidence. F13 remains pending because [the five-person observation record](familiar-work-v5-usability-observation.md) has no real participant results. The fixture model verifies routing and behavior without making a live-production-model claim. This set is macOS-only; Windows evidence remains a later release gate.

The machine-readable [evidence manifest](familiar-work-v5-evidence.json) separates the pre-acceptance product base from the source files changed during acceptance. It freezes the renderer and screenshot-E2E source digests alongside each screenshot and passing command result, so the new responsive layout cannot be attributed to the older base commit. Run `pnpm verify:familiar-v5` to validate revision ancestry, exact source identity, criterion references and coverage, the exact command set, passing result JSON, complete PNG chunks/scanlines and SHA-256 digests.

## Refresh procedure

Run `pnpm capture:familiar-v5` on native macOS with a prepared runtime. It removes prior generated inputs, executes all seven suites, and only then freezes current result JSON and screenshots. `pnpm verify:familiar-v5` checks all seven E2E source digests and the product surface. The 2026-09-07 run fixed a test race: the restored composer became ready before historical turns were rendered. The recovery test now waits for matching history and retains the exact turn/conversation count assertions. All seven suites passed; conversation, restored-session and narrow version screenshots were inspected. This is automated evidence, not F13 participant observation.
