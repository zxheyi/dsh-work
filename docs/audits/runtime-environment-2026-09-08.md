# Runtime environment audit — 2026-09-08

Baseline: `6979cd5` (PR #42). Tracking: [Issue #43](https://github.com/zxheyi/dsh-work/issues/43). Scope: desktop → guardian → official CLI → native tools, plus packaged executable/resource resolution and Profile paths. This is a targeted audit of defects similar to `spawn osascript ENOENT`, not proof that every product feature is defect-free.

## Confirmed defects

| Priority | Trigger and observed failure before the fix | Cause | Correction and regression |
| --- | --- | --- | --- |
| P1 | A macOS foreground Bash operation fails before executing its command; direct `bash`, `sh`, `ls` probes all return ENOENT. | The pinned `@deepseek-ai/dsh-bash-local` invokes `bash` by name. The product runtime PATH excludes `/bin`, where macOS keeps these executables. | Admit fixed `/bin` after bundled Node and `/usr/bin`. `official-launcher.test.ts` runs real Bash and basic child commands using the exact launch environment. |
| P2 | Start desktop with an incompatible `NODE_OPTIONS`; Node version probe exits with status 9 and the desktop falls back to guardian-unavailable. | `createGuardianClient` probes Node before constructing its allowlist, inheriting an option that is intentionally excluded from the actual guardian. | Use the same allowlisted environment for probe and spawn. `guardian-client.test.ts` starts a real guardian with invalid ambient Node options. |

The Node-options test establishes startup contamination, not arbitrary preload execution: `node --version` did not execute a missing `--require` hook in the preliminary probe. The more severe interpretation was rejected.

## Adjacent checks and limits

| Area | Evidence or disposition |
| --- | --- |
| macOS directory picker | Real noninteractive AppleScript still executes successfully. Upstream selection/cancellation behavior is unchanged; no OS chooser interaction is automated here. |
| Windows native picker | Pinned provider spawns `process.execPath` with an absolute worker path, so it does not share the macOS interpreter lookup bug. Native GUI selection remains outside this check. |
| Windows process-tree cleanup | Pinned subprocess provider invokes `taskkill` by name. A harmless `taskkill /?` test under the product environment is included for native CI; classify from its result, not POSIX emulation. |
| Windows PowerShell | Pinned resolver probes known install locations and SystemRoot, then PATH. No blanket claim of PowerShell ENOENT is justified. Nonstandard install discovery remains constrained by the intentional PATH policy. |
| Search helper | Pinned file-search provider resolves packaged `@vscode/ripgrep` to an absolute executable, not system `rg`; absence of global rg alone is not a bug. |
| Packaged Node and resources | Desktop uses `process.resourcesPath`; JS assets derive from `fileURLToPath(import.meta.url)`; Node/CLI are absolute argv entries, and packaging disables ASAR for external Node. Existing relocated package smoke validates a path containing the app name's space and ignores development overrides. |
| Profile paths | Explicit owned homes, checked absolute overlays, source rediscovery, and managed generation cwd are retained. No user Profile bytes are modified by these fixes. |
| Deleted parent cwd | A real isolated caller deleted its cwd before starting an idle guardian; startup still succeeded on macOS. Not reported as a defect; other platforms are not proven by this probe. |
| Guardian PATH | Guardian itself does not invoke the OS picker or shell. Expanding its PATH is unnecessary; the CLI launcher independently constructs the runtime environment. |
| Homebrew, custom tools and proxy variables | Deliberately excluded ambient configuration is a compatibility limitation, not permission to inherit every environment variable. A broader developer-environment policy would require a separate decision. |
| Linux | Not a supported native packaging target. No Linux desktop functionality is claimed or changed. |

## Verification

Before changes: both new defect regressions failed on macOS arm64 / Node 24.11.1; Bash returned ENOENT and the guardian probe exited 9. After changes: those regressions and the existing real AppleScript probe pass. Full product, runtime and native CI results are recorded with the PR; the report must not treat a successful startup smoke as proof of every lazy native tool path.

See [ADR 0019](../decisions/0019-runtime-environment-compatibility.md) for the accepted environment policy and rollback.
