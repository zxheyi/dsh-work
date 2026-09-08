# 0018: macOS runtime system utility path

Status: accepted

## Context and evidence

[Issue #41](https://github.com/zxheyi/dsh-work/issues/41) records Add Workspace failing with `spawn osascript ENOENT`. The pinned `@deepseek-ai/dsh-host-directory-picker-native@0.1.2-alpha.2` invokes `osascript` by name. `createOfficialLauncher` previously set PATH to only the bundled Node directory. A real, headless AppleScript execution under that launcher environment reproduces ENOENT before the fix. The repeated error prefix originates in the upstream controller and client wrappers.

## Decision

On macOS only, the official runtime launcher appends `/usr/bin` to its constructed PATH, after the bundled Node directory. It continues to discard the inherited PATH and all non-allowlisted environment variables. The explicit, version-checked Node executable and official CLI remain authoritative. The guardian's own environment stays unchanged: the launcher constructs the child's PATH even when its parent has a restricted PATH.

This admits macOS system utilities to runtime child command lookup. It is an environment compatibility correction, not an OS sandbox: Harness still owns tool authorization. Do not import login-shell PATH, Homebrew paths, or current-directory entries. Windows and Linux PATH behavior remains unchanged; their native picker behavior is outside this defect's scope.

## Alternatives, verification and rollback

Inheriting PATH would also admit arbitrary user-installed command locations. Patching the upstream picker to use an absolute path would introduce an unnecessary package exception. Replacing the picker would duplicate an existing native integration. The fixed system location corrects the product-owned launch environment without those changes.

The launcher tests assert exact PATH contents, bundled Node precedence and secret filtering, and execute real `osascript` with a noninteractive script on macOS. The latter fails with ENOENT before the fix and does not open a GUI in unit tests. Runtime integration and native desktop checks are recorded in the PR; headless execution alone does not prove dialog selection or cancellation. Revert the fix commit to roll back; no dependency or data migration is involved.
