# 0019: Runtime environment compatibility

Status: accepted

## Context

The follow-up audit in [Issue #43](https://github.com/zxheyi/dsh-work/issues/43) found two product-owned environment failures beyond the native directory picker. The pinned foreground Bash executor calls `bash` by name; macOS stores Bash and basic commands such as `sh` and `ls` under `/bin`. ADR 0018 admitted `/usr/bin` only. Real subprocess tests under the launcher environment fail with ENOENT.

The guardian's version probe also ran before environment sanitization. An incompatible inherited `NODE_OPTIONS` causes the standalone Node probe to exit with status 9, even though the guardian child itself would receive an allowlisted environment.

## Decision

Extend ADR 0018's macOS runtime PATH to bundled Node, `/usr/bin`, `/bin`, in that order. Continue excluding the inherited PATH, login-shell configuration, Homebrew locations and current-directory entries. This supports the existing Harness-native shell and OS helper composition; it does not introduce a different tool executor or authorization policy.

Construct the guardian's existing environment allowlist before its version probe and use the same environment for both probe and spawn. Preserve version rejection and explicit executable requirements. Do not broaden the guardian's own PATH or forward Node startup options.

Windows and Linux behavior is not broadened speculatively. A native Windows command lookup probe checks the upstream process-tree helper in CI. Custom developer tool discovery and Linux desktop support remain separate product decisions.

## Verification and rollback

Permanent tests preserve the original failures: real macOS Bash executes `ls` and `sh` with the exact runtime environment; real guardian startup succeeds despite invalid ambient Node options. Existing native AppleScript, environment filtering, version rejection and runtime lifecycle checks protect adjacent behavior. The audit report records native matrix results and remaining limits.

Revert the bounded compatibility changes to roll back; no persisted-data or dependency migration is needed. Upstream source and packages remain unchanged.
