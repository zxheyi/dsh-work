# M0 lifecycle prototype evidence

Status: macOS and Windows development prototype evidence; packaged-app and graceful Windows stop checks pending

Related work: [Issue #5](https://github.com/zxheyi/dsh-work/issues/5)

Date: 2026-08-28

## Question

If DSH Work selects a separate Harness process, can the M0 desktop host represent launch, executable readiness, requested stop, clean exit, startup failure, and an unexpected post-readiness exit without relying on a fixed delay or collapsing failures into `stopped`?

The first fixture tests the separate-process lifecycle model. A second smoke replaces the fixture with the official published npm runtime. Electron and Tauri smokes then run that same official runtime through their respective desktop process APIs. These results prove both macOS development topologies and basic Windows native launch/readiness are viable, but do not prove Windows graceful stop or packaged-product behavior.

## Disposable artifacts

The local experiment lives outside the product tree under `/private/tmp/dsh-work-m0-prototypes/`:

- `lifecycle-state-machine.html` is a single-file interactive state-machine walkthrough;
- `fake-harness.mjs` simulates a runtime process and emits explicit lifecycle signals;
- `lifecycle-probe.mjs` launches the process, observes stdout/stderr and exit, and requests a graceful stop;
- `real-harness-probe.mjs` exercises the official published `dsh` runtime;
- `electron-host/` and the verified Electron distribution exercise the desktop child-process topology;
- `tauri-host/` and its isolated Rust toolchain exercise the Tauri sidecar topology.

The reproducible host sources are captured under [`../../prototypes/m0-desktop-hosts/`](../../prototypes/m0-desktop-hosts/) on the research branch. They are intentionally not product code. Before architecture documentation merges, the throwaway source must leave the merge diff; `main` retains only the validated decision and links to the research branch and CI evidence.

## Command

```bash
node /private/tmp/dsh-work-m0-prototypes/lifecycle-probe.mjs
```

Environment:

- Node.js `v24.11.1`;
- macOS local process execution;
- simulated Harness process, not the official runtime.

## Observed results

| Scenario | Readiness | Exit | Final classification |
| --- | --- | --- | --- |
| Normal start and requested stop | explicit `HARNESS_READY` stdout signal | code `0` | `stopped` after `starting → ready → stopping` |
| Failure before readiness | no readiness signal | code `21` | `failed` with `startup-failure` |
| Crash after readiness | explicit readiness signal observed | code `42` | `failed` with `unexpected-exit` |

The experiment also kept stdout, stderr, exit code, and signal as separate evidence rather than converting them into one unstructured message.

## Preliminary answer

For a separate Harness process, the minimum lifecycle contract is coherent with five externally visible phases:

```text
stopped → starting → ready → stopping → stopped
               ↘ failed ← unexpected process exit
```

Readiness must come from an executable Harness signal. Process creation alone is not readiness. A non-zero or signaled exit becomes `failed` unless it follows an explicit stop request and satisfies the accepted clean-stop contract.

The reviewed [dsh-desktop launcher at revision `8bfc99c`](https://github.com/anywhere-labs/dsh-desktop/blob/8bfc99c1597a10966f3d20f963cd2efe82d6f4b1/dsh-plugin-desktop/src/main.ts) used another topology: its Electron main process called `@deepseek-ai/dsh-app-boot` `boot(...)` and injected desktop services into the resulting Cordis Host. Current official Harness architecture now defines the `dsh` CLI as the sole supported Node application launcher and rejects direct in-process application trees. The dsh-desktop code is therefore historical topology evidence, not permission to use an unsupported embedding path for M0.

## Official published runtime smoke

The current official architecture makes the `dsh` CLI the supported Node application launcher; direct in-process mounting is not a supported application entry. See [`deepseek-harness-integration.md`](deepseek-harness-integration.md) for the fixed-revision source evidence and the source/runtime version gap.

The published `@deepseek-ai/dsh@0.1.1-rc.2` runtime was installed in a disposable pnpm project outside the repository. The run used:

- macOS arm64;
- Node.js `v24.11.1`;
- pnpm `10.34.4`;
- an isolated temporary `DSH_HOME`;
- telemetry disabled;
- no DeepSeek credential;
- the official `dsh web --no-open --port 0` entry.

Observed checks:

| Check | Result |
| --- | --- |
| `dsh --help` | passed; Profile, patch, config-dump, Web, and plugin-management routes were present |
| `dsh --profile web --dump-config` | passed; base and Web Bundle rows composed without booting the app |
| Web boot inside the restricted workspace sandbox | failed with `listen EPERM` on `127.0.0.1`; correctly classified as an environment restriction, not a Harness defect |
| Web boot with local-loopback permission | printed `dsh web: http://127.0.0.1:<random-port>` after Loader settlement |
| HTTP after readiness | returned status `200` |
| Parent `SIGTERM` after readiness | child exited with code `0` and no terminating signal |

The repeatable local command was:

```bash
node /private/tmp/dsh-work-m0-prototypes/real-harness-probe.mjs
```

This is direct evidence that the published runtime can support the macOS half of `starting → ready → stopping → stopped` without modifying Harness source. It does not prove a secret-safe versioned readiness protocol: `0.1.1-rc.2` emits a human-readable URL line, while current source has already evolved its lifecycle contract.

## Electron host smoke

The desktop-host prototype used the same installed official runtime through a separate child process. It did not import `@deepseek-ai/dsh-app-boot` or change Harness source.

Environment and provenance:

- Electron `44.0.0`, downloaded from the official GitHub release;
- artifact `electron-v44.0.0-darwin-arm64.zip`;
- SHA-256 `076d79742986e1b100b69ebecc691cb07368045e54c9087cef631b8622b76a80`, matching the official `SHASUMS256.txt` entry;
- Electron embedded Node.js `24.18.1` for the desktop main process;
- the child command resolved the separately installed `@deepseek-ai/dsh@0.1.1-rc.2` runtime through the prototype environment;
- hidden `BrowserWindow` with context isolation, renderer sandboxing, and Node integration disabled.

Observed lifecycle:

| Step | Result |
| --- | --- |
| Desktop host ready | hidden renderer loaded successfully |
| Harness spawn | one child process started |
| Readiness | official `dsh web:` line observed, followed by HTTP `200` |
| Stop request | Electron main sent POSIX `SIGTERM` |
| Exit | child exited with code `0` and no terminating signal |

This validates the macOS development topology for an Electron supervisor. It does not yet validate a packaged standalone Node/runtime, secret-safe readiness, native Bundle activation, Windows shutdown, process-tree ownership, signing, notarization, or installer behavior.

## Tauri host smoke

The Tauri comparison used an isolated temporary Rust toolchain and later reran from the checked-in throwaway source. It staged the standalone Node executable as a Tauri `externalBin`, launched the same official `dsh` JavaScript entry through `tauri-plugin-shell`, and granted no shell capability to the hidden WebView.

Environment and provenance:

- Rust `1.98.0` and Cargo `1.98.0`, installed under `/private/tmp` after the official `rustup-init` SHA-256 matched its published checksum;
- Tauri `2.11.5`, `tauri-build` `2.6.3`, and `tauri-plugin-shell` `2.3.5` from the locked Cargo dependency graph;
- macOS arm64 using WKWebView;
- standalone Node plus official `@deepseek-ai/dsh@0.1.1-rc.2` as the sidecar command;
- hidden Tauri window with `core:default` only and no renderer shell permission.

Observed lifecycle:

| Step | Result |
| --- | --- |
| Desktop host ready | hidden WKWebView loaded successfully |
| Harness spawn | Tauri shell plugin started one Node sidecar running the official `dsh` bin |
| Readiness | redacted official `dsh web:` line observed, followed by HTTP `200` |
| Stop request | Rust core sent POSIX `SIGTERM` to the owned sidecar PID |
| Exit | sidecar emitted `Terminated` with code `0` and no terminating signal |

Both the temporary prototype and the research-branch source completed with result code `0`. This establishes lifecycle feasibility parity on macOS. The prototype alone did not establish a product preference; [ADR 0001](../decisions/0001-electron-desktop-host.md) subsequently accepted Electron for M0 and paused Tauri product work while retaining this result as reevaluation evidence.

## Windows prototype contract

[`../../.github/workflows/m0-windows-prototype.yml`](../../.github/workflows/m0-windows-prototype.yml) runs both checked-in throwaway hosts on `windows-latest` after this research branch is pushed. Both use Node `24.11.1`, pnpm `10.34.4`, official `@deepseek-ai/dsh@0.1.1-rc.2`, and the locked desktop dependencies.

Until a Harness-native child-visible public stop carrier is proven, the Windows probes deliberately classify cleanup as `forced-no-public-carrier`. A green job proves native host launch, readiness, HTTP `200`, and direct-child forced cleanup only. It cannot satisfy the M0 graceful-stop, descendant-cleanup, packaging, or recovery criteria.

## Windows native CI result

[GitHub Actions run `33159188420`](https://github.com/zxheyi/dsh-work/actions/runs/33159188420) completed successfully on `windows-latest` for research commit `e7643884934230b96b28fa897c3ed6905dfcb0f2`.

| Host | Build and launch | Readiness | Cleanup classification | Workflow result |
| --- | --- | --- | --- | --- |
| Electron separate process | official runtime materialized with pinned Node/pnpm; host launched one direct child | `dsh web:` line followed by HTTP `200` | `forced-no-public-carrier`; host result code `0` | passed |
| Tauri sidecar | Rust/Tauri compiled natively; target-suffixed standalone Node sidecar launched official `dsh` | `dsh web:` line followed by HTTP `200` | `forced-no-public-carrier`; host result code `0` | passed |

The run proves that both development hosts can compose the same unmodified official Harness runtime on Windows. It deliberately does not treat forceful direct-child cleanup as graceful stop or process-tree ownership evidence. ADR 0001 uses this matched feasibility result to remove basic platform launch as a host differentiator; the remaining lifecycle work now proceeds only on Electron.

## What this does not prove

- a stable, versioned Harness health/readiness protocol beyond the released URL line;
- Windows graceful stop and owned process-tree cleanup;
- packaged Electron or Tauri execution;
- one native Profile or Bundle activation;
- Electron or Tauri packaging behavior;
- Windows process-tree termination semantics;
- recovery after an interrupted profile write or partially materialized runtime;
- behavior when the runtime ignores graceful termination.

## Required next prototype

Extend the official runtime smoke with a DSH Work-native lifecycle Bundle and owned process-tree recovery. The next acceptance-grade executable check must verify:

1. a real Profile or Bundle is selected;
2. readiness comes from a public Host/runtime boundary;
3. normal shutdown releases the owned process tree;
4. startup and abnormal-exit diagnostics preserve actionable structured evidence;
5. the pinned upstream source remains byte-clean before and after the run.
