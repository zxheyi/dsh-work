# 0001: Electron child-process desktop host

Status: proposed

Date: 2026-08-28

## Problem

M0 needs one thin macOS and Windows desktop host that can supervise the official DeepSeek Harness launcher, show a web/plugin UI, diagnose failures, and recover owned resources without embedding or reimplementing Harness. The host selection affects the security boundary, runtime packaging, process ownership, platform CI, and future maintenance cost.

## Evidence

- [`../research/desktop-stack-comparison.md`](../research/desktop-stack-comparison.md) compares Electron 44 and Tauri 2.11 from primary framework, runtime, and operating-system sources.
- [`../research/deepseek-harness-integration.md`](../research/deepseek-harness-integration.md) establishes that the supported application boundary is the official `dsh --profile` CLI, not direct in-process mounting.
- [`../research/m0-lifecycle-prototype.md`](../research/m0-lifecycle-prototype.md) records a macOS arm64 smoke in which Electron `44.0.0` launched official `@deepseek-ai/dsh@0.1.1-rc.2`, observed the readiness line, fetched HTTP `200`, sent `SIGTERM`, and observed exit code `0`.
- Electron artifact integrity was verified against the official release SHA-256 list.
- An equivalent macOS Tauri `2.11.5`/shell-plugin `2.3.5` prototype used standalone Node as a configured sidecar, reached HTTP `200`, sent POSIX `SIGTERM`, and observed exit code `0`. Its hidden WebView had no shell capability.
- Native Windows and packaged-product checks remain pending for both candidates.

## Decision

Propose Electron `44.0.0` as the M0 desktop host, using a separate official `dsh` child process. This proposal is not accepted until the unchecked criteria below pass.

Electron main owns lifecycle, diagnostics, recovery, and platform integration. The renderer owns presentation only and receives a narrow typed bridge. The renderer keeps context isolation and sandboxing enabled, Node integration disabled, and receives no generic shell or filesystem access.

The host launches the selected standalone Node executable and official `dsh` bin with `shell: false`, an explicit DSH Work Profile, a DSH Work-owned `DSH_HOME`, bounded streams, and immutable packaged runtime inputs. Electron's embedded Node is not assumed to be compatible with Harness and is not the initial child runtime.

## Acceptance and verification

- [x] An official Electron artifact passes integrity verification.
- [x] A macOS development smoke launches one official Harness child, observes executable readiness plus HTTP `200`, requests stop, and receives exit code `0`.
- [x] An equivalent macOS Tauri sidecar smoke passes against the same official runtime and lifecycle sequence.
- [ ] A packaged macOS app runs without global Node or package-manager dependencies.
- [ ] A packaged Windows app runs without global Node or package-manager dependencies.
- [ ] Native macOS and Windows tests prove graceful stop, bounded forced recovery, owned descendant cleanup, and restart after host/runtime failure.
- [ ] One accepted Harness-native DSH Work Profile or Bundle loads through the official CLI.
- [ ] Security tests prove that trusted renderer APIs are narrow and plugin/remote content cannot invoke generic process, filesystem, or credential operations.
- [ ] Repeated lifecycle and package measurements compare Electron and Tauri on the same native machines.

The proposed implementation cannot begin beyond disposable prototypes until this ADR is accepted. Verification commands and native CI links must be added when each unchecked criterion is completed.

## Alternatives considered

### Tauri sidecar host

Tauri offers a small Rust core, system WebViews, and declarative capability scoping. Its macOS lifecycle prototype passed. It also requires a Rust toolchain, separate Node/Harness sidecars for each target, native WebView compatibility testing, and the same platform-specific process-tree ownership code. It remains the active comparison candidate until the native matrix and measurement gates above are resolved.

### Electron in-process Harness embedding

The historical DSH Desktop reference used `@deepseek-ai/dsh-app-boot` in Electron main. Current official Harness architecture excludes direct in-process mounting as a supported application launcher, so this topology is rejected for M0 even though Electron can technically load Node modules in main.

## Consequences

- The product ships Chromium and Electron's embedded Node in addition to the selected standalone Harness Node runtime unless a later compatibility decision removes the duplication.
- Electron and Chromium security updates become part of the product release cadence.
- Harness crashes are isolated from Electron main, but lifecycle communication and OS-level process ownership become explicit product responsibilities.
- macOS 13 and 64-bit targets are the current Electron 44 framework floor; the product support matrix may be narrower but not broader without new evidence.
- Native macOS and Windows packaging, signing, launch, shutdown, and recovery CI are mandatory before M0 release.

## Rollback or supersession

Before acceptance, reject this proposal without migration if the equivalent Tauri prototype produces materially better accepted lifecycle, security, packaging, or maintenance evidence. After implementation, supersede this ADR only with a migration plan that preserves the same typed UI boundary and official `dsh --profile` runtime contract; Harness Profiles, Bundles, and work surfaces must remain host-independent.
