# Familiar Work v5 acceptance

Status: accepted target; implementation pending

Fact source: [R01-R18 and scenarios](../design/familiar-v5/requirements.json). Decision: [ADR 0014](../decisions/0014-familiar-conversations-and-versioned-files.md). Evidence and task ownership: [implementation issue](../implementation/familiar-v5.md).

| ID | Observable result | Verification |
| --- | --- | --- |
| F1 | Native sidebar, selected Workspace/Session, new/search/settings and original composer; no goal form | Loader/Profile smoke, two-session Electron E2E, desktop screenshot |
| F2 | Missing model blocks button/Enter without losing draft; connected model enables ordinary follow-up and stop | Model integration, credential-negative cases, E2E |
| F3 | Imported files have clear copy semantics and real provenance; invalid files cannot count as read | Byte/path/format integration and import E2E |
| F4 | Allow-once/refuse use original authorization and restore the original conversation | Positive and denied-operation integration, E2E |
| F5 | Only actual validated outputs open a sanitized, on-demand preview beside the chat | Turn correlation, path/security/late-read tests, E2E |
| F6 | Revision uses the same composer/Session and preserves last-valid bytes on failure | Corruption/interruption injection, same-Session E2E |
| F7 | Save is independent of adoption, uses selected bytes, and reports success only after copy | Digest, conflict, retry and cancellation tests, E2E |
| F8 | Immutable versions survive restart; compare reads real bytes; restore creates a new version | Snapshot/interruption/conflict integration, comparison screenshot |
| F9 | Adoption refers to a specific file/version and never closes the conversation | State-domain tests, adopt-then-revise E2E |
| F10 | Runtime failure returns to original context without blindly replaying external actions | Guardian/process E2E and lifecycle regression |
| F11 | 390px/736px layouts and keyboard can return to conversation and complete main actions | Responsive screenshots, keyboard/focus/accessible-name checks |
| F12 | Legacy Work data retains IDs/files; absent history remains explicitly absent | Compatibility fixture, later full migration interruption/rollback suite |
| F13 | At least four of five existing DSH users complete the core flow without learning new product terms | Real human observation; automated checks are not a substitute |

The eight scenario paths are: initial connection, ordinary conversation, attachment/generation, file reading, revision/versions, adoption/save, permission, and revision failure. Every state must link to evidence from the tested revision. Pending Windows, human study or live-model evidence stays pending; a macOS screenshot cannot satisfy it.

Historical Shell S3-S6 remain required: exact authenticated loopback handoff, no renderer desktop bridge, runtime recovery, clean restart persistence and uncertain-generation isolation. Existing M0 packaging/platform requirements remain release gates.

Native Save As, full migration and additional formats are follow-on acceptance under R15/R16/R18, not silently included in a phase-B completion claim.
