# 0001: Electron child-process desktop host

Status: accepted

Date: 2026-08-28

## Problem

M0 needs one thin macOS and Windows desktop host that can supervise the official DeepSeek Harness launcher, show a web/plugin UI, diagnose failures, and recover owned resources without embedding or reimplementing Harness. The host selection affects the security boundary, runtime packaging, process ownership, platform CI, and future maintenance cost.

## Evidence

- The frozen [desktop-stack comparison](https://github.com/zxheyi/dsh-work/blob/4fd63ddefc347238f5a5c717a10bd59a2f326693/docs/research/desktop-stack-comparison.md) compares Electron 44 and Tauri 2.11 from primary framework, runtime, and operating-system sources.
- The frozen [Harness integration research](https://github.com/zxheyi/dsh-work/blob/4fd63ddefc347238f5a5c717a10bd59a2f326693/docs/research/deepseek-harness-integration.md) establishes that the supported application boundary is the official `dsh --profile` CLI, not direct in-process mounting.
- The frozen [M0 lifecycle prototype record](https://github.com/zxheyi/dsh-work/blob/4fd63ddefc347238f5a5c717a10bd59a2f326693/docs/research/m0-lifecycle-prototype.md) records a macOS arm64 smoke in which Electron `44.0.0` launched official `@deepseek-ai/dsh@0.1.1-rc.2`, observed the readiness line, fetched HTTP `200`, sent `SIGTERM`, and observed exit code `0`.
- Electron artifact integrity was verified against the official release SHA-256 list.
- An equivalent macOS Tauri `2.11.5`/shell-plugin `2.3.5` prototype used standalone Node as a configured sidecar, reached HTTP `200`, sent POSIX `SIGTERM`, and observed exit code `0`. Its hidden WebView had no shell capability.
- [Windows CI run `33159188420`](https://github.com/zxheyi/dsh-work/actions/runs/33159188420) built and launched both development hosts against the same official runtime, reached HTTP `200`, and completed bounded direct-child forced cleanup. It intentionally does not claim graceful Windows stop or descendant cleanup.
- Packaged-product, Windows graceful-stop, and owned process-tree checks remain open. They are Electron implementation and M0 release gates, not evidence that Tauri currently provides a better lifecycle path.

## Decision

Accept Electron `44.0.0` as the M0 desktop host, using a separate official `dsh` child process. This decision selects the implementation direction; it does not declare the desktop lifecycle implemented or M0 complete.

Electron main owns lifecycle, diagnostics, recovery, and platform integration. The renderer owns presentation only and receives a narrow typed bridge. The renderer keeps context isolation and sandboxing enabled, Node integration disabled, and receives no generic shell or filesystem access.

The host launches the selected standalone Node executable and official `dsh` bin with `shell: false`, an explicit DSH Work Profile, a DSH Work-owned `DSH_HOME`, bounded streams, and immutable packaged runtime inputs. Electron's embedded Node is not assumed to be compatible with Harness and is not the initial child runtime.

Electron is selected because both candidates passed the same basic macOS and Windows development-host checks, while Tauri did not remove the separately delivered Node/Harness runtime or solve the shared graceful-stop and owned-process-tree work. Electron keeps the lifecycle controller in the repository's Node/TypeScript stack, uses the official CLI through the direct `child_process` boundary, and gives the product and Harness plugin UI one pinned Chromium engine across macOS and Windows. For M0, this delivery and maintenance advantage outweighs Tauri's potential host-size and declarative-capability advantages, which have not yet been measured in the product configuration.

## Acceptance and verification

- [x] An official Electron artifact passes integrity verification.
- [x] A macOS development smoke launches one official Harness child, observes executable readiness plus HTTP `200`, requests stop, and receives exit code `0`.
- [x] An equivalent macOS Tauri sidecar smoke passes against the same official runtime and lifecycle sequence.
- [x] Native Windows development smokes build and launch both candidates, observe readiness plus HTTP `200`, and report bounded direct-child forced cleanup without misclassifying it as graceful.
- [x] The product owner accepted Electron for M0 with Tauri paused under the conditions recorded below.
- [ ] A packaged macOS app runs without global Node or package-manager dependencies.
- [ ] A packaged Windows app runs without global Node or package-manager dependencies.
- [ ] Native macOS and Windows tests prove graceful stop, bounded forced recovery, owned descendant cleanup, and restart after host/runtime failure.
- [ ] One accepted Harness-native DSH Work Profile or Bundle loads through the official CLI.
- [ ] Security tests prove that trusted renderer APIs are narrow and plugin/remote content cannot invoke generic process, filesystem, or credential operations.
- [ ] Repeated Electron lifecycle and package measurements establish the M0 operating baseline on native macOS and Windows.

This accepted decision authorizes Electron-only M0 implementation. Each unchecked item remains a mandatory M0 verification gate and must gain commands and native CI evidence before the corresponding completion claim.

## Alternatives considered

### Tauri sidecar host

Tauri offers a small Rust core, system WebViews, and declarative capability scoping. Its macOS lifecycle and Windows native launch/readiness prototypes passed, so it is not rejected as technically infeasible. It also requires a Rust toolchain, separate Node/Harness sidecars for each target, native WebView compatibility testing, and the same platform-specific process-tree ownership code.

Tauri is paused for M0 under these conditions:

- no Tauri or Rust production dependency, product host, packaging pipeline, or duplicate lifecycle controller is added;
- the disposable Tauri prototype and its native CI receipt remain research evidence, not product code to merge into `main`;
- M0 verification proceeds only against Electron unless a reevaluation trigger below is met; and
- host-independent lifecycle types, Harness Profiles/Bundles, work surfaces, and acceptance checks must not depend on Electron internals, preserving a feasible future migration boundary.

### Electron in-process Harness embedding

The historical DSH Desktop reference used `@deepseek-ai/dsh-app-boot` in Electron main. Current official Harness architecture excludes direct in-process mounting as a supported application launcher, so this topology is rejected for M0 even though Electron can technically load Node modules in main.

## Consequences

- The product ships Chromium and Electron's embedded Node in addition to the selected standalone Harness Node runtime unless a later compatibility decision removes the duplication.
- Electron and Chromium security updates become part of the product release cadence.
- Harness crashes are isolated from Electron main, but lifecycle communication and OS-level process ownership become explicit product responsibilities.
- macOS 13 and 64-bit targets are the current Electron 44 framework floor; the product support matrix may be narrower but not broader without new evidence.
- M0 production code and CI do not add Rust or Tauri toolchains; the existing research prototype remains isolated evidence.
- Native macOS and Windows packaging, signing, launch, shutdown, and recovery CI are mandatory before M0 release.

## Rollback or supersession

Reevaluate Electron only when at least one of these conditions is supported by reproducible evidence:

- Electron cannot satisfy an M0 lifecycle, security, platform-support, packaging, or distribution requirement through a bounded design, while Tauri can satisfy the same requirement against the same official Harness runtime;
- measured Electron package size, startup time, memory, update delta, or repeated-cycle stability exceeds an agreed product budget, and a matched Tauri measurement materially improves it without weakening another accepted gate;
- Electron's supported operating-system floor or security-update cadence conflicts with an accepted product requirement;
- the official Harness distribution changes so that a native sidecar removes the current Node/runtime duplication and materially changes the host trade-off; or
- product scope explicitly prioritizes system-WebView integration or minimum host footprint strongly enough to justify the Rust and cross-WebView maintenance cost.

Reevaluation requires a new research issue, matched macOS/Windows evidence, and a superseding ADR. It does not authorize opportunistic dual-stack implementation. Any migration must preserve the typed UI boundary and official `dsh --profile` runtime contract; Harness Profiles, Bundles, and work surfaces remain host-independent.
