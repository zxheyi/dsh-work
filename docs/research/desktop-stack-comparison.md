# DSH Work M0 desktop stack comparison

Status: research evidence; not an architecture decision

Evidence reviewed: 2026-08-28

## Question and constraints

This note compares Electron and Tauri as the thin macOS/Windows host for the M0 lifecycle in [`../acceptance/m0.md`](../acceptance/m0.md). The host must launch the selected official DeepSeek Harness `dsh` CLI and Profile exactly once as a child process, capture its diagnostics, derive readiness from an executable signal, stop and recover safely, present a web/plugin UI, and leave the pinned Harness source read-only and byte-clean. The companion [`deepseek-harness-integration.md`](deepseek-harness-integration.md) establishes this upstream integration boundary.

This is a primary-source review of framework documentation, source, release records, Node.js/Rust process documentation, and operating-system process documentation. It does not use third-party package-size, memory, startup-time, or performance claims. Those properties need measurement against the same Harness build and UI in runnable prototypes.

No third framework is added. Both main candidates have first-party evidence for the required window, process, resource, security, and packaging primitives; adding another candidate before either fails a decision gate would widen the experiment without resolving a verified gap.

## Version and license snapshot

Versions here are a dated research baseline, not dependency selections. An ADR and lockfiles must pin the versions actually prototyped.

| Stack | Current evidence on 2026-08-28 | License and runtime baseline | Platform implications visible now |
| --- | --- | --- | --- |
| Electron | The official release service identifies `44.0.0` as the latest stable major, released 2026-08-24, with Chromium `152.0.7977.54` and Node.js `24.18.1`. Electron supports the latest three stable major lines. [release](https://releases.electronjs.org/release/v44.0.0), [schedule and support window](https://releases.electronjs.org/schedule), [support policy](https://www.electronjs.org/docs/latest/tutorial/electron-timelines) | Electron is MIT licensed. Its application binary embeds Chromium and Node.js, so a shipped app carries those runtimes and their dependency notices as well as product dependencies. [license](https://github.com/electron/electron/blob/main/LICENSE), [runtime model](https://www.electronjs.org/docs/latest/) | Electron 44 requires macOS 13 or newer and is published only for 64-bit architectures; official artifacts include x64 and arm64 for macOS and Windows. [44.0.0 breaking changes](https://releases.electronjs.org/release/v44.0.0), [artifact platforms and architectures](https://www.electronjs.org/docs/latest/tutorial/installation) |
| Tauri | The official ecosystem release page lists core `tauri` `2.11.5` (2026-07-01), CLI `2.11.4`, Wry `0.56.0`, Tao `0.36.0`, and shell plugin `2.3.5`. [release index](https://tauri.app/release/) | Tauri code is MIT or Apache-2.0 where applicable. Its core is a compiled Rust binary and it dynamically uses OS WebViews rather than shipping a browser runtime. A Node/Harness runtime therefore remains a separate product dependency with its own licenses. [repository and licenses](https://github.com/tauri-apps/tauri), [architecture](https://tauri.app/concept/architecture/) | Tauri documents macOS 10.15+ and Windows 7+ support, but Windows development requires Microsoft C++ Build Tools and WebView2; macOS desktop development requires Xcode Command Line Tools. Product support can be narrower and must be tested on the selected OS matrix. [prerequisites](https://tauri.app/start/prerequisites/) |

Electron's release cadence and Tauri's separately versioned core, CLI, Wry, Tao, and plugins both make an unqualified major version insufficient. The prototype record should include every package version, the exact official `@deepseek-ai/dsh` source/runtime pair, artifact integrity, and the packaged Node version.

## Official launcher constraint and remaining host comparison

At official revision [`cd5ef814`](https://github.com/deepseek-ai/deepseek-harness/tree/cd5ef8148158c3a752a658978873241fdf8e2bbc), `docs/architecture.md` states that every supported Node application launches through the `dsh` CLI with a named Profile and that direct in-process mounting is not a supported application launcher. M0 must therefore compare two desktop supervision implementations against the same official command shape, such as `dsh --profile <dsh-work-profile> --no-open --port 0`, not compare embedded and child-process Harness topologies. [official application-launch contract](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/docs/architecture.md#application-launch), [Harness integration research](deepseek-harness-integration.md#supported-application-entrypoints)

| Active M0 host path | Launcher and runtime | Lifecycle evidence needed | Main trade-offs to prototype |
| --- | --- | --- | --- |
| **Electron child process** | Electron main uses Node process APIs to launch the packaged official `dsh` CLI with the selected DSH Work Profile. The renderer receives only typed lifecycle and UI operations through a narrow preload bridge. | Spawn error, bounded stdout/stderr, official Web readiness, exit code/signal, cross-platform graceful shutdown, bounded forced termination, owned descendant cleanup, stale-state recovery, and host-crash orphan handling. | JavaScript/TypeScript controller and fixed Chromium; may package a second Node runtime instead of coupling the CLI to Electron's embedded Node; requires platform process-tree ownership code. |
| **Tauri sidecar** | Tauri Rust core launches the same packaged official `dsh` CLI/runtime and Profile as a configured sidecar. The WebView receives only typed lifecycle and UI operations. | The same product lifecycle contract as Electron, implemented through Tauri shell/Rust process and operating-system primitives. | Rust controller and system WebViews; Node is always a separately delivered runtime; capability scoping is declarative, while process-tree ownership still needs platform code beyond the direct-child handle. |

### Historical in-process reference, not an M0 candidate

At DSH Desktop revision `8bfc99c`, `dsh-plugin-desktop/src/main.ts` imported `boot` from `@deepseek-ai/dsh-app-boot`, awaited `boot(...)` inside Electron main, bound the returned Host context to a startup generation, and released that generation during shutdown. This remains useful historical evidence explaining why an earlier comparison considered direct Node-module composition. [fixed historical source](https://github.com/anywhere-labs/dsh-desktop/blob/8bfc99c1597a10966f3d20f963cd2efe82d6f4b1/dsh-plugin-desktop/src/main.ts)

It is not an allowed M0 integration path. Electron technically permits Node-module composition in main, but the current official Harness architecture explicitly excludes direct in-process mounting from supported application launchers. DSH Work must not import `@deepseek-ai/dsh-app-boot`, copy the historical mounting pattern, or use that reference to bypass the official `dsh --profile` lifecycle.

## Summary comparison

| M0 concern | Electron 44 | Tauri 2.11 |
| --- | --- | --- |
| Thin host implementation | Main process is JavaScript/TypeScript on embedded Node.js; renderers use embedded Chromium. Main supervises the official `dsh` child. | Core process is Rust; web UI runs in the OS WebView. Core supervises the same official `dsh` runtime as a sidecar. |
| Start and observe Harness | `child_process.spawn()` launches the exact packaged Node executable and official `dsh` bin with `--profile`; it exposes spawn/error, stdout, stderr, exit, and close. [Node child process](https://nodejs.org/api/child_process.html) | `tauri-plugin-shell` launches the configured official `dsh` sidecar. Its Rust API returns a `CommandChild` and a stream of stdout, stderr, error, and terminated events; the termination payload contains exit code and, on Unix, signal. [sidecar guide](https://tauri.app/develop/sidecar/), [plugin process API/source](https://docs.rs/tauri-plugin-shell/latest/src/tauri_plugin_shell/process/mod.rs.html) |
| Stop | Request shutdown through the selected Harness child-visible public seam, then use bounded direct/tree termination only for recovery. Electron quit events can delay ordinary quit, but Windows shutdown/restart/logout does not emit them. [Harness stop evidence](deepseek-harness-integration.md#start-stop-and-failure-behavior), [app lifecycle](https://www.electronjs.org/docs/latest/api/app) | The shell child supports stdin writes and `kill()`, but its public handle has no signal selection or stdin-close operation. Its current implementation delegates `kill()` to a forceful direct-child kill, so graceful stop must use the same selected Harness child-visible seam as Electron and reserve kill for timeout recovery. [CommandChild](https://docs.rs/tauri-plugin-shell/latest/tauri_plugin_shell/process/struct.CommandChild.html), [stdin-close issue](https://github.com/tauri-apps/plugins-workspace/issues/2136), [Rust `Child::kill`](https://doc.rust-lang.org/std/process/struct.Child.html) |
| Whole process-tree cleanup | `ChildProcess.kill()` does not establish whole-tree cleanup; the prototype needs explicit owned-tree evidence. [Node child process](https://nodejs.org/api/child_process.html) | Cleanup is not guaranteed by the shell plugin's direct-child handle; dropping a Rust `Child` does not terminate it, and stable direct-child `kill()` is forceful. [Rust `Child`](https://doc.rust-lang.org/std/process/struct.Child.html) |
| Runtime delivery | Package the selected official `@deepseek-ai/dsh` distribution, exact compatible Node executable, and Profile/Bundle tree under `extraResource`. Do not treat Electron's embedded Node as proof of CLI compatibility. [Electron environment](https://www.electronjs.org/docs/latest/api/environment-variables), [packager resources](https://electron.github.io/packager/main/interfaces/Options.html#extraResource) | Tauri deliberately does not ship Node. `externalBin` bundles per-target executables, while `bundle.resources` includes the same selected official DSH runtime and Profile/Bundle tree. [external binaries](https://tauri.app/develop/sidecar/), [Node sidecar](https://tauri.app/learn/sidecar-nodejs/), [resources](https://tauri.app/develop/resources/) |
| Web/plugin UI | One packaged Chromium version gives the same browser engine on both platforms. Renderer Node integration should stay disabled; a narrow preload/context bridge connects UI to lifecycle operations. Separate `WebContentsView`s can display additional web contents when isolation is needed. [process model](https://www.electronjs.org/docs/latest/tutorial/process-model), [context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation), [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view) | Any frontend that compiles to HTML/CSS/JS can run, but macOS uses WKWebView and Windows uses WebView2. UI/plugin compatibility therefore depends on both system WebViews and OS versions. Rust commands/events bridge the WebView and core. [process model](https://tauri.app/concept/process-model/), [WebView versions](https://tauri.app/reference/webview-versions/) |
| Native capability boundary | Electron recommends renderer sandboxing, context isolation, no Node integration for remote content, sender validation, navigation restrictions, CSP, and narrowly wrapped IPC. These are application rules rather than a declarative command allowlist. [security checklist](https://www.electronjs.org/docs/latest/tutorial/security), [context bridge](https://www.electronjs.org/docs/latest/api/context-bridge/) | Capabilities grant permissions per window/WebView, and dangerous shell commands are blocked by default until explicitly scoped. Lifecycle can remain entirely in Rust, avoiding any frontend shell permission. [capabilities](https://tauri.app/security/capabilities/), [shell permissions](https://tauri.app/plugin/shell/) |
| Packaging and signing | Official Forge/Packager tooling packages prebuilt Electron plus app code and extra resources. macOS signing/notarization requires macOS/Xcode; Windows signing is supported by Electron tooling, including remote/cloud approaches. [distribution](https://www.electronjs.org/docs/latest/tutorial/application-distribution), [code signing](https://www.electronjs.org/docs/latest/tutorial/code-signing) | Tauri CLI produces platform installers and bundles configured resources/sidecars. The architecture document states cross-compilation is not available and directs builds to per-platform CI. Most distribution targets require signing. [distribution](https://tauri.app/distribute/), [architecture build flow](https://github.com/tauri-apps/tauri/blob/dev/ARCHITECTURE.md) |
| Read-only Harness source | Feasible by packaging an immutable official `dsh` runtime outside the pinned source tree and extending it only through Profile/Bundle/plugin/service entries. Electron itself does not enforce source cleanliness. | The same invariant applies to the Tauri sidecar; Tauri itself does not enforce source cleanliness. |

## Electron findings

### Official CLI child process

The supported M0 path is `child_process.spawn(exactNodeExecutable, [exactDshBin, '--profile', selectedProfile, '--no-open', '--port', '0'], { shell: false, stdio: ['pipe', 'pipe', 'pipe'] })`. Node creates the three pipes by default, exposes child error/exit/close events, supports a controlled working directory and environment, and can hide a child console window on Windows. Avoiding a shell also avoids shell parsing and quoting as part of the lifecycle boundary. The product must use a DSH Work-owned `DSH_HOME` and an accepted Profile/Bundle rather than modify Harness. [Node `child_process`](https://nodejs.org/api/child_process.html), [official CLI contract](deepseek-harness-integration.md#supported-application-entrypoints)

`utilityProcess.fork(modulePath)` can create a Node child, pipe stdout/stderr, and expose spawn/exit/PID, but it is not the baseline for this comparison: it launches a JavaScript module rather than an arbitrary packaged executable, supports no stdin, and inherits Electron's Node build and version. It may be evaluated only if it invokes the selected official CLI distribution without bypassing the `dsh --profile` entry and supports the chosen cross-platform stop carrier. [Electron `utilityProcess`](https://www.electronjs.org/docs/latest/api/utility-process)

Electron can also relaunch its executable as normal Node with `ELECTRON_RUN_AS_NODE`. Electron documents exceptions caused by its BoringSSL-based Node build, including unavailable OpenSSL/FIPS flags. Therefore “Electron includes Node” does not prove compatibility with the selected official DSH runtime, native add-ons, cryptography configuration, or child behavior. The fair baseline packages the same exact standalone Node and `dsh` runtime used by the Tauri prototype; embedded Node can be a later packaging optimization only after equivalent compatibility evidence. [Electron environment variables](https://www.electronjs.org/docs/latest/api/environment-variables)

### Shutdown and recovery limits

Ordinary app quit can be intercepted with `before-quit` or `will-quit`, allowing Electron to request child shutdown and wait. Those events are not emitted on Windows system shutdown, restart, or logout, so recovery cannot depend on an in-process finalizer. [Electron app lifecycle](https://www.electronjs.org/docs/latest/api/app)

Node's process documentation is explicit that `kill()` sends a signal and may not terminate the process. On Windows, common POSIX signal names force abrupt termination; killing a shell does not necessarily terminate its descendants. Harness installs a supported SIGTERM path on POSIX, while its own tests state that Windows has no externally deliverable SIGTERM. The Electron prototype must therefore prove a two-phase policy rather than claim one signal works cross-platform. [Harness stop evidence](deepseek-harness-integration.md#start-stop-and-failure-behavior)

1. request graceful stop with SIGTERM on POSIX and through the selected child-visible DSH Work Bundle/public `appExit` carrier on Windows;
2. after a bounded timeout, terminate only the owned process tree and record the forced recovery.

For Windows, Job Objects are the operating-system primitive for managing a process group as a unit; `TerminateJobObject` terminates all associated processes. On macOS/POSIX, the corresponding prototype needs an owned process group and group-directed signals. This is lifecycle code outside Electron's high-level API and must never select unrelated processes by port or executable name. [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects), [TerminateJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-terminatejobobject), [Node detached/process groups](https://nodejs.org/api/child_process.html#optionsdetached)

Recovery also needs a run identity and owned transient directory, not just a remembered PID: Node warns that a PID can be reassigned before a later signal is sent. The prototype should validate ownership metadata and a live Harness identity/readiness response before reusing or deleting transient state. [Node child kill caveat](https://nodejs.org/api/child_process.html#subprocesskillsignal)

### Packaging and UI boundary

Electron Packager can copy one or more `extraResource` entries directly beside packaged resources and exposes the location through `process.resourcesPath`. That is sufficient to stage the checksummed official `dsh` distribution, exact Node executable, and immutable Profile/Bundle inputs without writing into the pinned Harness checkout. Executables and mutable Profiles/state should remain outside `app.asar`. [Packager `extraResource`](https://electron.github.io/packager/main/interfaces/Options.html#extraResource), [ASAR application packaging](https://www.electronjs.org/docs/latest/tutorial/application-distribution)

The renderer should contain presentation only. Electron's current defaults include context isolation and renderer sandboxing, but the product still has to keep `nodeIntegration` disabled, expose one narrow method/event per lifecycle action through a preload bridge, validate every IPC sender and argument, restrict navigation/window creation, and apply CSP. Harness/plugin web content that is not the trusted product renderer should use an isolated content boundary and receive no unrestricted desktop bridge. [security checklist](https://www.electronjs.org/docs/latest/tutorial/security), [preload guidance](https://www.electronjs.org/docs/latest/tutorial/tutorial-preload)

Additional Electron-specific risks to prove are:

- Electron 44's macOS 13 and 64-bit floor may be narrower than the desired product support matrix.
- A fixed Chromium simplifies engine consistency but makes Chromium/Node security updates part of the product release cadence; Electron officially supports only three stable major lines.
- Packaging standalone Node avoids coupling the official CLI to Electron's embedded Node, but duplicates a Node runtime and increases package/update inventory.
- Using embedded Node later could remove that duplication, but requires explicit compatibility evidence for the exact official DSH distribution and native dependencies.
- The child boundary adds readiness/stop-channel design and process-tree recovery, although it also isolates Harness failures from Electron main.
- `before-quit` is not a reliable last-chance cleanup hook for Windows OS session termination.

## Tauri findings

### Runtime and process fit

Tauri's Rust core is the only component with full operating-system access; the WebView renders HTML/CSS/JavaScript and communicates through core IPC. This is a natural location for a lifecycle controller that never exposes generic process execution to the renderer. [Tauri process model](https://tauri.app/concept/process-model/)

The official shell plugin supports normal commands and configured sidecars on macOS and Windows. In Rust, `spawn()` returns a `CommandChild` plus events for stdout, stderr, error, and termination; stdin writes and a direct-child PID are available. The source waits for termination and emits exit code plus Unix signal. This covers the observation primitives required by M0. [shell plugin](https://tauri.app/plugin/shell/), [process source](https://docs.rs/tauri-plugin-shell/latest/src/tauri_plugin_shell/process/mod.rs.html)

If sidecar control is exposed directly to JavaScript, Tauri requires explicit `shell:allow-spawn`, `shell:allow-kill`, and argument/command scopes, with dangerous operations blocked by default. DSH Work does not need that exposure: a fixed Rust lifecycle module can own the exact executable, arguments, environment, readiness, and stop policy, while the WebView receives only typed start/stop/status operations. [shell permissions](https://tauri.app/plugin/shell/), [capabilities](https://tauri.app/security/capabilities/)

### Node/Harness delivery

Tauri does not provide a Node runtime. Its bundler treats per-target executables as `externalBin`; each sidecar name must have a Rust target-triple suffix, so macOS arm64/x64 and Windows arm64/x64 need matching artifacts. Additional directories can be included through `bundle.resources` and resolved from the resource directory. [external binaries](https://tauri.app/develop/sidecar/), [resources](https://tauri.app/develop/resources/)

Tauri's official Node-sidecar guide presents two approaches:

- compile a Node application into a self-contained binary;
- ship the Node runtime itself and JavaScript as bundled resources.

The guide also says long-lived applications should consider an appropriate IPC mechanism rather than assume its short-lived example applies. For Harness, a frozen single executable must not be assumed compatible with dynamic native plugins, module resolution, Profiles, Bundles, or runtime package updates. The first Tauri prototype should therefore use an exact standalone Node executable plus an immutable Harness runtime tree, and test a self-contained executable only if that preserves native Harness composition. [Node sidecar guide](https://tauri.app/learn/sidecar-nodejs/)

### Shutdown, UI, and packaging limits

The shell plugin's `CommandChild.kill()` sends a kill to the direct child, and Rust defines stable `Child::kill()` as forceful. Dropping a Rust `Child` does not terminate it. The official plugin repository still has an open process-group request whose maintainer discussion confirms the current API targets the child PID rather than guaranteeing descendant cleanup. As with Electron, M0 needs protocol-level graceful stop followed by a bounded process-tree recovery path; a direct shell-plugin kill alone is insufficient evidence. [Tauri `CommandChild`](https://docs.rs/tauri-plugin-shell/latest/tauri_plugin_shell/process/struct.CommandChild.html), [process-group request](https://github.com/tauri-apps/plugins-workspace/issues/1332), [Rust `Child`](https://doc.rust-lang.org/std/process/struct.Child.html)

Tauri uses WKWebView on macOS and WebView2 on Windows rather than shipping one browser engine. That creates a required UI/plugin matrix: the same Harness client plugin must load and behave on both engines at the minimum supported OS versions. Unsupported macOS releases do not receive WebKit updates. [Tauri process model](https://tauri.app/concept/process-model/), [WebView version policy](https://tauri.app/reference/webview-versions/)

The Tauri CLI produces native bundles and installers, but its architecture document says cross-compilation is not currently available. Native macOS and Windows CI jobs are therefore part of the basic prototype, not release-only follow-up. Sidecars and runtime resources must be signed/notarized with the containing application as required by each platform. [Tauri build flow](https://github.com/tauri-apps/tauri/blob/dev/ARCHITECTURE.md), [distribution](https://tauri.app/distribute/)

Additional Tauri-specific risks to prove are:

- The Rust/JavaScript/Node toolchain and separately versioned Tauri components add integration and update surfaces.
- A system-WebView UI may expose OS-version-specific CSS, JavaScript, storage, focus, clipboard, and embedded-content differences.
- One Node/Harness sidecar artifact is needed per target platform and architecture; a single-executable packager may conflict with Harness-native dynamic loading.
- The shell plugin's high-level child handle does not establish a Windows Job Object or prove descendant cleanup.
- Broad `shell` or resource capabilities would weaken Tauri's declarative security benefit; lifecycle and runtime resources should stay inaccessible to untrusted WebViews.
- Tauri plugins are compiled Rust crates with optional JavaScript bindings, not Harness-native runtime plugins. DSH Work must keep product extension behavior in Harness Profiles, Bundles, and plugins rather than create a Tauri-plugin product ecosystem. [Tauri plugin development](https://tauri.app/develop/plugins/)
- CSP is not a substitute for capabilities and must be explicitly configured; remote scripts and untrusted content should not share the privileged product WebView. [Tauri CSP](https://tauri.app/security/csp/)
- The shell plugin has had a high-severity command-scope validation vulnerability in versions through `2.2.0`, fixed in `2.2.1`; the prototype's `2.3.5` pin is outside the affected range, but security advisory tracking remains part of releases. [official advisory](https://github.com/tauri-apps/plugins-workspace/security/advisories/GHSA-c9pr-q8gx-3mgp)

## Common source-cleanliness and security requirements

Neither framework guarantees the DSH Work upstream invariant. Both prototypes must use the same independently verifiable runtime contract:

- record the official Harness repository, exact source revision, runtime kind, official `@deepseek-ai/dsh` version, Node version, and artifact integrity as a tested pair; do not equate current source revision `cd5ef814` with the older published npm `0.1.1-rc.2` runtime;
- materialize the exact Node executable, official `dsh` distribution, and DSH Work Profile/Bundle inputs into a generated staging directory outside the pinned source checkout;
- build a manifest and hashes for the staged runtime artifacts and retain their license inventory;
- run the upstream remote/revision/clean-tree check before and after packaging and lifecycle tests;
- launch only the official `dsh --profile <dsh-work-profile> --no-open --port 0` entry and extend it through accepted Profile/Bundle/plugin/service boundaries;
- keep mutable state, logs, caches, Profiles, credentials, and recovery metadata in platform application-data directories, never in packaged resources or the upstream checkout;
- give each run a DSH Work-owned `DSH_HOME`, working directory, identity, and transient directory;
- retain the official loopback default, authenticate and authorize the selected desktop-to-runtime control channel, and treat the one-time token in the current `dsh web:` readiness URL as a credential;
- redact arguments, environment values, readiness credentials, stdout/stderr, and crash diagnostics before exposing or persisting them; and
- expose lifecycle verbs and structured status to the UI, never a generic shell, unrestricted filesystem, raw environment, or arbitrary IPC bridge.

Packaging a clean copy does not prove the runtime uses a public extension boundary. The Loader/Profile smoke must independently identify the exact native entry that loaded the DSH Work Profile or Bundle.

## Recommended throwaway prototypes

Select one explicit official source/runtime pair for an experiment, then, on each target platform, give both desktop prototypes byte-identical Node, `dsh`, Profile, and Bundle artifacts plus identical arguments, environment policy, readiness contract, stop contract, and UI. If more than one source/runtime pair remains under consideration, repeat the two-host comparison for each pair rather than allowing each framework to use a different Harness build. These experiments are not a final stack selection.

### Prototype E: Electron child-process host

Pin Electron `44.0.0` and official packaging tooling. Use a sandboxed, context-isolated local renderer and a narrow preload API. In the main process:

1. package the exact selected Node executable, official `@deepseek-ai/dsh` distribution, and Profile/Bundle tree with `extraResource`;
2. spawn the official CLI directly with `shell: false`, `--profile <dsh-work-profile> --no-open --port 0`, a scrubbed explicit environment, DSH Work-owned `DSH_HOME`, and all three pipes;
3. consume the selected secret-safe readiness signal, retain bounded redacted stdout/stderr, and emit typed lifecycle states;
4. exercise POSIX SIGTERM and the selected Windows child-visible `appExit` carrier, followed after the bounded grace period by owned process-group/Windows Job Object recovery; and
5. build, package, and launch on native macOS and Windows with no global Node or package-manager dependency.

The earliest smoke may parse the upstream `dsh web:` line, but it must redact the embedded token. A DSH Work lifecycle Bundle may replace that with a framed secret-safe signal only if the selected released pair proves the necessary public lifecycle services; current HEAD behavior must not be assumed for npm `0.1.1-rc.2`. [readiness evidence](deepseek-harness-integration.md#readiness-and-health-signals)

### Prototype T: Tauri sidecar host

Pin core `tauri` `2.11.5`, CLI `2.11.4`, and shell plugin `2.3.5`. Use a local WebView UI with lifecycle commands implemented only in Rust. In the core:

1. configure the same exact Node executable used by Prototype E as a target-specific `externalBin`, and package the same official `dsh` distribution and Profile/Bundle tree as immutable `resources`;
2. launch the same CLI arguments from Rust with the same environment and DSH Work-owned directories, stream stdout/stderr/termination into the same typed lifecycle schema as Prototype E, and grant no renderer shell permission;
3. use the same readiness signal and platform-specific graceful-stop contract as Prototype E;
4. implement and test equivalent owned process-group/Windows Job Object fallback; and
5. build and launch on native macOS and Windows, then run the same plugin UI smoke in WKWebView and WebView2.

Do not make a frozen Node single-executable artifact the only Tauri prototype. First prove that it preserves native Harness module, Profile, Bundle, and plugin loading; otherwise compare with the explicit Node-plus-runtime-tree layout.

### Checks shared by both prototypes

Run the same black-box checks against development and packaged builds on native macOS and Windows:

- provenance records the official source commit, runtime package/version, Node version, and artifact hash, and the upstream checkout remains byte-clean;
- a missing runtime artifact identifies the exact searched item and recovery action;
- an incompatible runtime reports product, source, runtime, desktop-framework, and Node versions;
- concurrent activation commands spawn exactly one owned `dsh --profile` child;
- TCP bind alone does not mark Ready; the selected readiness record plus a real page/authenticated-path smoke does;
- startup timeout, invalid Profile/Bundle, plugin activation failure, spawn failure, nonzero exit, exit signal, and `EADDRINUSE` are distinguishable without exposing the Web token or other credentials;
- a port conflict does not kill or attach to the unrelated owner;
- POSIX SIGTERM reaches the official graceful shutdown path and exits zero;
- the selected Windows child-visible request reaches public `appExit` and exits zero; ordinary `kill('SIGTERM')` is not accepted as proof;
- normal stop releases the port and every owned descendant, while timeout recovery cleans only the owned process tree and is labeled forced;
- killing the desktop or runtime and relaunching safely handles orphans and stale metadata before a successful isolated restart;
- at least 20 repeated spawn/ready/stop cycles leave no owned listener, port, transient lock, task, or process;
- one real Harness-native Profile or Bundle loads from the accepted public entry with the pinned source still byte-clean;
- the packaged app works without global Node, Rust, package-manager, or developer-tool installations; and
- the trusted product UI and an isolated plugin/remote-content fixture cannot invoke generic process, filesystem, or credential APIs.

The cycle count is a proposed prototype stress check, not a reliability claim or final M0 limit.

## Decision criteria and remaining implementation evidence

The comparison used the following criteria. ADR 0001 now selects Electron for M0 based on the matched feasibility evidence and the product owner's delivery and maintenance judgment. Criteria not yet answered remain Electron implementation or M0 release gates; accepting the host does not convert them into verified facts.

1. **Harness fidelity:** Can the same exact official `dsh --profile` source/runtime pair, Node version, native dependencies, Loader, Profile/Bundle, and plugin UI run under each host without modifying or copying Harness-owned implementation?
2. **Lifecycle correctness:** Do native macOS and Windows tests prove spawn-exactly-once, trustworthy readiness, platform-correct graceful stop, owned process-tree cleanup, abnormal-exit diagnostics, orphan handling, and restart recovery?
3. **Runtime independence:** Can source revision, runtime package, desktop stack, packaged Node, and mutable user data be upgraded or rolled back independently with explicit manifests?
4. **Security boundary:** Is all OS/process authority confined to Electron main or Tauri Rust core, with a small typed UI bridge and no generic shell exposure? Is the child control/readiness channel authenticated or otherwise ownership-bound, and can remote/plugin content be isolated?
5. **Web/plugin compatibility:** Does the real Harness client/plugin UI behave on the chosen Electron Chromium or on the selected WKWebView/WebView2 support matrix?
6. **Packaging reproducibility:** Can native CI create signed/notarized macOS and signed Windows packages containing the exact Node/`dsh`/Profile/Bundle assets, with no global dependencies and a verifiable license inventory?
7. **Operational diagnosability:** Are spawn, readiness, stream, exit, version mismatch, port conflict, Windows stop, and forced-recovery outcomes distinguishable without leaking secrets?
8. **Maintenance cost:** Which candidate produces the smaller accepted set of languages, runtime copies, native modules, platform-specific process code, security update obligations, and release jobs for this team? This must be counted from the prototypes, not inferred from framework marketing.
9. **Measured product properties:** Compare package contents, startup-to-ready time, idle/active memory, update delta, and repeated-cycle stability using the same pinned Harness build, command, Profile/Bundle, and UI on the same machines. Record raw commands and results; do not import unrelated public benchmarks.

The historical Electron in-process `boot(...)` reference is excluded by the current official launcher contract and is not an M0 prototype. [ADR 0001](../decisions/0001-electron-desktop-host.md) accepts the Electron child-process host and pauses Tauri product work. Tauri remains research evidence and may be reconsidered only through the explicit triggers and superseding-decision process in that ADR.

## Prototype update: 2026-08-28

The macOS arm64 throwaway prototypes now give both candidates the same standalone Node and official `@deepseek-ai/dsh@0.1.1-rc.2` runtime:

| Host | Window/runtime boundary | Observed result |
| --- | --- | --- |
| Electron `44.0.0` | hidden sandboxed Chromium renderer; Electron main spawned the standalone Node/official `dsh` child | readiness line, HTTP `200`, POSIX SIGTERM, exit code `0` |
| Tauri `2.11.5` + shell plugin `2.3.5` | hidden WKWebView with no shell capability; Rust core launched standalone Node as a configured sidecar | readiness line, HTTP `200`, POSIX SIGTERM, exit code `0` |

The result removed basic macOS lifecycle feasibility as a differentiator. It did not by itself select a host; ADR 0001 subsequently selected Electron based on the full evidence and product priorities. Windows public graceful stop, owned process-tree cleanup, packaged runtime independence, real plugin UI behavior, security verification, and repeated Electron measurements remain M0 gates. Commands and exact provenance are recorded in [`m0-lifecycle-prototype.md`](m0-lifecycle-prototype.md); the throwaway sources live on the research branch under [`../../prototypes/m0-desktop-hosts/`](../../prototypes/m0-desktop-hosts/).

[Windows CI run `33159188420`](https://github.com/zxheyi/dsh-work/actions/runs/33159188420) subsequently built and launched both checked-in throwaway hosts on `windows-latest`. Each launched the same official runtime, observed the `dsh web:` readiness line and HTTP `200`, and reported `forced-no-public-carrier` before bounded direct-child cleanup. This removes basic Windows build/launch/readiness feasibility as a differentiator, but it does not satisfy graceful stop, descendant cleanup, packaging, recovery, or WebView compatibility acceptance.
