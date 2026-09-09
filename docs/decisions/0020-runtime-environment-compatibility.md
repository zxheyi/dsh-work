# 0020: Runtime environment compatibility

Status: accepted

## Context

The follow-up audit in [Issue #43](https://github.com/zxheyi/dsh-work/issues/43) found three product-owned environment failures beyond the native directory picker. The pinned foreground Bash executor calls `bash` by name; macOS stores Bash and basic commands such as `sh` and `ls` under `/bin`. ADR 0018 admitted `/usr/bin` only. Real subprocess tests under the launcher environment fail with ENOENT.

The guardian's version probe also ran before environment sanitization. An incompatible inherited `NODE_OPTIONS` causes the standalone Node probe to exit with status 9, even though the guardian child itself would receive an allowlisted environment.

The native Windows CI probe also reproduced `spawnSync taskkill ENOENT` on revision `b741b64` ([run](https://github.com/zxheyi/dsh-work/actions/runs/34185286190)). The pinned subprocess provider uses this command for process-tree cancellation, but the runtime PATH contains only Node.

## Decision

Extend ADR 0018's macOS runtime PATH to bundled Node, `/usr/bin`, `/bin`, in that order. Continue excluding the inherited PATH, login-shell configuration, Homebrew locations and current-directory entries. This supports the existing Harness-native shell and OS helper composition; it does not introduce a different tool executor or authorization policy.

Construct the guardian's existing environment allowlist before its version probe and use the same environment for both probe and spawn. Preserve version rejection and explicit executable requirements. Do not broaden the guardian's own PATH or forward Node startup options.

On Windows, append `System32` under the absolute OS-provided `SystemRoot` (case-insensitive, with `WINDIR` fallback) after bundled Node. Do not guess `C:\Windows`: nonstandard system drives are valid. Reject missing, relative, drive-relative and PATH-delimiter-containing roots from command lookup. A harmless real `taskkill /?` probe runs on Windows; it verifies helper resolution, not every descendant-cleanup scenario. Linux behavior is unchanged. Custom developer tool discovery and Linux desktop support remain separate product decisions.

## Verification and rollback

Permanent tests preserve the original failures: real macOS Bash executes `ls` and `sh` with the exact runtime environment; real guardian startup succeeds despite invalid ambient Node options. Existing native AppleScript, environment filtering, version rejection and runtime lifecycle checks protect adjacent behavior. The audit report records native matrix results and remaining limits.

Revert the bounded compatibility changes to roll back; no persisted-data or dependency migration is needed. Upstream source and packages remain unchanged.
