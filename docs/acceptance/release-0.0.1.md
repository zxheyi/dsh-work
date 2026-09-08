# 0.0.1 functional acceptance

On 2026-09-08, all four functional paths passed on macOS arm64 with the real DeepSeek official provider and deepseek-v4-flash. The [frozen manifest](release-0.0.1-evidence/manifest.json) binds the three executions to one run ID and the actual source bytes. The base revision is recorded separately from uncommitted source digests; a base revision alone is not evidence for this change.

| Requested path | Actual evidence |
| --- | --- |
| Fresh setup and first message | Empty isolated credentials; native onboarding accepts the provider key; a completed real assistant turn replies with the requested marker. |
| Attachment, generation, revision and save | Synthetic Project Orchid brief is attached; the real Agent writes release-report.md; a second request revises it; the saved copy matches file bytes. |
| Existing Profile and history | Byte-identical copies of the existing web Profile manifest/patch load through the production desktop's local-Profile choice. Synthetic history created earlier in this run is readable. Original and copied config digests remain unchanged. |
| Failure recovery and lifecycle | Invalid key produces AUTH; a refused loopback connection produces TRANSPORT. Restoring configuration and restarting permits completed real replies. Closing the active window hides it while generation finishes. Production quit writes a clean terminal receipt; relaunch recovers cleanly and retains history and the background result. |

[Real generated-file and retained-history screenshot](release-0.0.1-evidence/live-result.png).

The fixture only seeds an empty workspace/session and observes synthetic request markers through the native extension chain; it does not replace model inference. Credentials are copied only into an owned temporary home and are not recorded. Private user histories are not inspected or migrated. Network testing covers connection refusal, not interrupting a live stream by disabling the host network. Recovery here includes restart after restoring configuration, not an assertion about hot credential reload. Real-provider and installed-package testing were separate runs; real-provider coverage on Windows and Intel macOS remains unverified.

An earlier strict whole-answer comparison failed when the real model returned both pending and current reply markers in one completed answer. The final check accepts an exact target line in the current completed assistant turn; regression tests still reject previous turns, user echoes and failed turns. The final manifest contains only the complete successful run, not combined partial runs.

## Reproduce

Use a compatible local Profile and credentials file explicitly; this consumes real model usage. The runner isolates all writes and removes its temporary home afterwards.

```sh
pnpm build
DSH_WORK_NODE=/absolute/path/to/verified/node pnpm test:release-live /absolute/path/to/.credentials.yaml /absolute/path/to/profiles/web
node scripts/verify-live-release.mjs
```

The verifier validates frozen receipts and hashes; it does not call a provider. A fresh live run writes to ignored artifacts/live-release and does not silently replace frozen evidence.

## Checks and release status

- `pnpm test`: 231 passed, including evidence and concatenated native Zstandard-frame regressions.
- `pnpm check`, repository contract tests, and `pnpm verify:familiar-v5`: passed; F13 remains pending.
- `pnpm test:desktop`: seven native lifecycle scenarios passed.
- `pnpm package:desktop` and `pnpm test:package`: unsigned 0.0.1 macOS arm64 bundle; relocated application launched twice and shut down cleanly without developer Node.
- `pnpm notices:verify-release`: failed as intended while [native distribution materials #38](https://github.com/zxheyi/dsh-work/issues/38) remain incomplete. Functional acceptance does not waive this distribution gate.

The user selected unsigned delivery, so [Developer ID #37](https://github.com/zxheyi/dsh-work/issues/37) is deferred for this candidate. No [F13 human observations #36](https://github.com/zxheyi/dsh-work/issues/36) exist. Prepare 0.0.1-release as a draft; public binary publication remains blocked by #38. Do not claim five-user usability acceptance or signed/notarized distribution. Revert this release-validation change to remove the version bump and optional live test tooling; no production Harness behavior or data format was changed.
