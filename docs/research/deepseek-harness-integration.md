# DeepSeek Harness integration research for DSH Work M0

Status: research snapshot

Inspected: 2026-08-28 (Asia/Shanghai)

Primary sources only: the official `deepseek-ai/deepseek-harness` Git repository, npm registry, and PyPI registry.

## Executive result

DeepSeek Harness already exposes the composition and lifecycle seams needed for a thin desktop supervisor: one `dsh` launcher, named Profiles, installable Bundle patches, ordinary Cordis plugins/services, Loader settlement, a Web readiness announcement, and bounded root disposal. DSH Work should therefore run an unmodified Harness child and add any desktop-specific lifecycle handshake as a DSH Work Bundle/plugin rather than embedding or forking Harness.

The research identified one selection risk: **the repository revision inspected is newer than every currently installable official runtime distribution**. The inspected Git revision is [`cd5ef8148158c3a752a658978873241fdf8e2bbc`](https://github.com/deepseek-ai/deepseek-harness/tree/cd5ef8148158c3a752a658978873241fdf8e2bbc) (`dsh-v0.1.2-alpha.1`), while npm resolves `@deepseek-ai/dsh` to `0.1.1-rc.2`, whose matching official tag points to [`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`](https://github.com/deepseek-ai/deepseek-harness/tree/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e). [ADR 0002](../decisions/0002-official-dsh-cli-runtime.md) resolves the selection by accepting that released pair as the M0 baseline; HEAD-only lifecycle APIs must not be assumed to exist in it.

## Evidence snapshot

The official repository was cloned without local edits. At inspection:

```text
remote:   https://github.com/deepseek-ai/deepseek-harness.git
branch:   master (origin/master)
commit:   cd5ef8148158c3a752a658978873241fdf8e2bbc
tag:      dsh-v0.1.2-alpha.1
version:  0.1.2-alpha.1
status:   clean
```

Registry queries made on the same date returned:

| Distribution | Registry result | Relevant provenance |
|---|---|---|
| npm `@deepseek-ai/dsh` | `latest` and `next` = `0.1.1-rc.2`; bin `dsh -> lib/bin.js`; no published `engines` field | [npm version page](https://www.npmjs.com/package/@deepseek-ai/dsh/v/0.1.1-rc.2), [matching Git tag](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.1-rc.2) |
| npm `@deepseek-ai/dsh@0.1.2-alpha.1` | not found (404) | [current source manifest](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/apps/cli/package.json) |
| PyPI `deepseek-harness-sdk` | `0.1.1rc1`; exact dependency on `deepseek-harness-runtime-bin==0.1.1rc1` | [PyPI JSON](https://pypi.org/pypi/deepseek-harness-sdk/json) |
| PyPI `deepseek-harness-runtime-bin` | `0.1.1rc1`; Linux x64/arm64 and macOS arm64 wheels visible, no Windows wheel visible | [PyPI JSON](https://pypi.org/pypi/deepseek-harness-runtime-bin/json) |

The source is explicitly a developer preview with compatibility-breaking changes expected ([README](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/README.md#developer-preview)).

## Confirmed facts

### 1. Package and runtime topology

- The repository is a pnpm monorepo spanning `apps/*`, two-level `packages/*/*`, vendored framework packages, native launchers, and Python runtime packaging. Source development pins `pnpm@11.7.0` and declares Node `^22.19.0 || >=24.0.0` ([root manifest](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/package.json#L1-L17)). The official development guide says CI covers Node 22.19, 24, and 26 ([development guide](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/docs/development.md#prerequisites)).
- `@deepseek-ai/dsh` is the application package and publishes the sole Node `dsh` bin. Its dependency closure contains the shipped base, Web, headless, SDK, and ACP Bundles plus the public service/plugin packages they mount ([CLI manifest](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/apps/cli/package.json)).
- The DSH npm release family intentionally shares one version across its publishable members, private packages, and workspace root ([release bump contract](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/scripts/release/bump.ts#L1-L15)). This is a package-family version, not source provenance; an exact Git commit is still a separate datum.
- The alternative Python runtime wheel packages the same `dsh` CLI and closed Node dependency tree as a native executable. Source declares Linux x64/arm64, macOS arm64, and Windows x64 targets; normal execution needs no system Node or pnpm, while external plugin management still needs pnpm ([runtime wheel reference](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/python/sdk-runtime/README.md#installed-commands-and-artifacts)). Current PyPI contents do not yet match the source's Windows-target claim, so registry contents, not HEAD documentation, govern what can be consumed today.

### 2. Supported application entrypoints

- Every supported Node application starts through the `dsh` CLI with a named Profile. Supported shipped surfaces are `web`, `headless`, `sdk`, `sdk-minimal`, and `acp`; direct in-process mounting and private preview executables are not supported application launchers ([architecture](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/docs/architecture.md#application-launch)).
- `apps/cli/src/bin.ts` parses the invocation and dynamically imports only the selected Profile, plugin-management, or config-dump runner ([bin source](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/apps/cli/src/bin.ts)). For M0 Web hosting, the supported child command is:

  ```text
  dsh --profile web --no-open --port 0
  ```

  `dsh web` is an alias. Port `0` requests an OS-assigned port; the CLI rejects `--host 0.0.0.0` for safety and defaults to `127.0.0.1` ([Web startup source](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/bundle/web-app/src/startup.ts)).
- Source-checkout execution is a development route requiring `pnpm install`, `pnpm run build`, then `pnpm dsh web`; it does not rebuild automatically on launch ([README](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/README.md#run-from-source)). Installed npm execution is `npx @deepseek-ai/dsh web` ([README](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/README.md#run-from-npm)).

### 3. Profile, Bundle, plugin, and service boundaries

- A Profile is a named composition under `$DSH_HOME/profiles/<name>`. Its `package.json` declares an ordered `dsh.profile.bundles` list and patch reload policy; its `cordis.patch.yml` is the user's layer. A Bundle is an npm package whose `dsh.bundle.patch` points to a patch file containing plugin rows ([profile types and templates](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/boot/app-boot/src/profile.ts#L40-L169)).
- Layers apply over an empty tree in this order: Bundle patches, Profile patch, home patch, then invocation `--patch` overlays. Later patches can replace a row's entire config or insert rows ([architecture](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/docs/architecture.md#profiles-and-bundles)).
- A plugin is an ordinary ESM module with `apply(ctx, config)` and optional `inject` service dependencies. Cordis waits for injected services, scopes registrations to the plugin Fiber, and recursively disposes effects/children ([plugin lifecycle](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/docs/user/develop/framework/index.md), [services](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/docs/user/develop/framework/service.md)). External Bundle installation is explicitly supported through `dsh plugin --profile <name> add <package>` ([plugin packaging guide](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/docs/user/develop/basic/publish.md)).
- Public services are named capabilities on `ctx`; the architecture names Agent/session/model/tool services and their owning packages rather than requiring callers to import private implementations ([core package map](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/docs/architecture.md#core-packages)). The current revision also publicly exposes launcher lifecycle services `ctx.appReady` and `ctx.appExit` through `@deepseek-ai/dsh-cmdline` ([cmdline source](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/boot/cmdline/src/index.ts#L28-L89)).

### 4. Readiness and health signals

- On the inspected revision, `runProfile()` commits `appReady` only after Loader boot and launcher-owned setup succeed and while the root Fiber and Loader remain active ([Profile boot](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/apps/cli/src/profile-boot.ts#L39-L60), [commit site](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/apps/cli/src/profile-boot.ts#L209-L302)).
- The shipped Web Bundle treats its `dsh web: <URL>` stdout line as the supervisor readiness signal. It emits the line only after the full Loader tree settles and the Web server plus authenticated Connection remain available ([Web readiness source](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/bundle/web-app/src/index.ts#L262-L309), [Web Bundle contract](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/bundle/web-app/README.md#readiness)). The current line contains a one-time process token in its URL; it is a credential and must not enter public diagnostics.
- The HTTP listener binding is weaker than application readiness: `WebServer.init()` binds immediately, while unnamed routes return 404 until their owners register ([WebServer source](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/host/webserver/src/index.ts#L101-L120)). A successful TCP connect or early HTTP response therefore cannot be DSH Work's Ready criterion.
- No dedicated process-level `/health`, `/ready`, or structured supervisor endpoint was found in the inspected Web composition. API-level `ready` frames found in the repository describe client Connection generations, not process readiness.

### 5. Start, stop, and failure behavior

- The launcher installs SIGTERM and SIGINT handlers before the Profile finishes booting. SIGTERM means ordinary supervisor stop (exit 0); SIGINT reports 130. Both dispose the root Fiber ([Profile boot](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/apps/cli/src/profile-boot.ts#L209-L228)). Root disposal recursively releases registered plugin resources.
- Shutdown is bounded at five seconds. Repeated shutdown requests coalesce; a second interrupt or a disposal timeout forces process exit ([shutdown controller](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/apps/cli/src/process-shutdown.ts)). WebServer disposal closes the listener, closes ordinary connections, destroys upgraded sockets, and awaits closure ([WebServer disposal](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/host/webserver/src/index.ts#L202-L309)).
- Current source exposes `exitOnStdinEnd()`, which waits for `appReady` and then routes stdin EOF through the bounded `appExit` path ([cmdline source](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/boot/cmdline/src/index.ts#L114-L145)). Officially it is used by the SDK and ACP stdio surfaces; using the same public seam from a DSH Work Web lifecycle Bundle is plausible but not yet verified.
- Windows is a special case: the upstream CLI tests explicitly state that Windows has no externally deliverable SIGTERM and simulate it from inside the child ([built-bin test](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/apps/cli/tests/built-bin.e2e.ts#L88-L99)). A desktop host must not claim graceful Windows shutdown by calling the ordinary child-process `kill('SIGTERM')` path.
- Boot failures dispose the partial root and exit nonzero. Diagnostics are human-readable stderr strings such as `host preparation failed`, `plugin tree failed to load`, and plugin-specific causes; listen conflicts retain `EADDRINUSE` ([boot source](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/boot/app-boot/src/index.ts#L743-L824), [WebServer failure contract](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/packages/host/webserver/README.md#behavior-under-failure)). These are not a versioned structured error protocol.

### 6. Evidence that upstream source can remain read-only

- The official runtime path is an installed package/executable; it does not require an application checkout at runtime.
- The official architecture says there is no privileged core to patch: behavior is extended by mounting plugins beside existing plugins, and their registrations unwind on unload ([architecture](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/docs/architecture.md#cordis)).
- Official Profiles and external Bundles live under the Harness home and their own package trees; Bundle patches override or insert Loader rows without changing upstream files ([CLI Profile contract](https://github.com/deepseek-ai/deepseek-harness/blob/cd5ef8148158c3a752a658978873241fdf8e2bbc/apps/cli/README.md#profiles)).
- The public `appReady`, `appExit`, Profile, Bundle, WebServer, Connection, and Cordis effect seams are sufficient to prototype desktop lifecycle outside upstream. No confirmed M0 requirement currently forces a Harness source edit.

## Implications for DSH Work (inference from confirmed facts)

1. **Pair source and runtime explicitly.** Record at least `sourceRepository`, `sourceCommit`, `runtimeKind`, `runtimePackage`, `runtimeVersion`, and artifact integrity. Do not document current HEAD as the source baseline for npm `0.1.1-rc.2`; use its matching tag/commit and rerun the lifecycle checks there, or build an artifact from `cd5ef814…` and record its hash.
2. **Prefer child-process composition over library embedding.** Launch the official `dsh --profile web` entrypoint with a DSH Work-owned `DSH_HOME`, working directory, and Bundle/Profile layer. This preserves upstream's loader, services, authorization, and plugin lifecycle.
3. **Make readiness explicit through a native DSH Work Bundle.** Parsing the upstream URL line is acceptable for an initial smoke but exposes a token and depends on text format. At `0.1.2-alpha.1`, a small Bundle can listen to public `appReady`, resolve the active Web URL through public services, and write a uniquely framed, secret-safe readiness record to a desktop-owned channel. This capability must be retested against whichever runtime is selected because npm `0.1.1-rc.2` predates `appReady`.
4. **Use a cross-platform in-process graceful-stop request.** POSIX can exercise SIGTERM, but Windows needs a child-visible request. A DSH Work lifecycle Bundle can route a parent-pipe EOF or bounded local IPC request to public `appExit`; the desktop host may force-terminate only after the upstream five-second grace plus its own small observation margin. The Web+stdin composition is not yet an upstream-declared contract and needs a prototype.
5. **Own structured diagnostics in the desktop layer.** Preserve raw private logs locally, but translate spawn failure, readiness timeout, nonzero exit, `EADDRINUSE`, invalid Profile, and forced-stop outcomes into DSH Work error categories. Treat upstream stderr wording as diagnostic evidence, not a stable API.
6. **Do not use the current PyPI wheel as the M0 cross-platform runtime.** Although current source declares a Windows x64 wheel target, the public `0.1.1rc1` registry release currently exposes no Windows wheel. Reconsider only after the selected exact release is available and verified on both target platforms.

## Unknowns that remain after baseline selection

- Does the selected released revision expose the lifecycle services required by the DSH Work Bundle, or must readiness/stop be implemented using older public seams?
- Can the selected runtime load a DSH Work Bundle from an installed, pinned tarball on clean macOS and Windows machines without pnpm at ordinary launch time?
- Does closing the Web child's stdin remain unused by every selected Web Bundle row and reliably reach `appExit` on Windows?
- What is the stable secret-safe control carrier: framed stdout/stderr, stdin EOF, Node IPC (not available to a standalone native executable by default), named pipe, or loopback authenticated endpoint?
- Does abnormal desktop termination leave child Agent/tool subprocesses that the outer host must reclaim? Upstream guarantees registered disposal, but an ungraceful host/runtime crash still requires an OS-level process owner.
- What compatibility promise, if any, will upstream make for `appReady`, `appExit`, the Web URL line, and external Bundle peer versions during developer preview?

## Proposed executable prototype checks

Run these against each candidate **source/runtime pair** on native macOS and Windows. None should edit the upstream checkout.

1. **Provenance and cleanliness**
   - Assert official remote URL and exact source commit.
   - Assert selected runtime package version and artifact SHA-512/SHA-256.
   - If source is vendored as a submodule, require `git -C <upstream> status --porcelain` to be empty, `git diff --quiet`, and the submodule gitlink to equal the recorded commit.
   - Reject DSH Work files under the upstream tree and reject a runtime version change in the same commit as a source-pin change.

2. **Loader/Profile activation**
   - Create an isolated temporary `DSH_HOME`.
   - Install or project one minimal `dsh-work-lifecycle` Bundle without modifying Harness.
   - Run `dsh --profile <dsh-work-profile> --dump-config` and assert the base/Web Bundles plus the lifecycle row are present exactly once.
   - Boot headlessly with `--no-open --port 0`; assert the Bundle reaches ACTIVE only after the Loader settles.

3. **Trustworthy readiness**
   - First prove TCP bind alone does not mark Ready.
   - Wait for a uniquely framed readiness record (or, in the earliest spike only, the `dsh web:` line), redact its token, then fetch the page and one authenticated API path.
   - Induce a sibling plugin activation failure and prove no readiness record is emitted.
   - Set a hard startup timeout and retain bounded stderr tail plus source/runtime versions.

4. **Normal and forced stop**
   - POSIX: send SIGTERM and assert exit 0, port release, and no owned descendants.
   - Windows: request stop through the DSH Work child-visible channel, assert it reaches `appExit`, exit 0, port release, and no owned descendants.
   - Stall one disposer; assert the upstream five-second bound forces exit and DSH Work reports `forced_stop`, not `clean_stop`.
   - Repeat start/stop at least 20 times with an OS-assigned port and isolated transient state.

5. **Failure and recovery**
   - Missing runtime: structured `runtime_missing` with the searched path.
   - Version mismatch: structured error containing both source commit and runtime version.
   - Occupied fixed port: preserve `EADDRINUSE`, do not kill the unrelated owner, then recover with port `0`.
   - Invalid Bundle/Profile: name the offending config, start with a clean recovery Profile, and leave the broken input untouched.
   - Kill the runtime mid-start and after Ready; assert state transitions to Failed, owned descendants are reclaimed, and a new isolated launch succeeds.

6. **Packaging boundary**
   - Test from a clean machine/user context with no repository checkout.
   - If using npm, bundle the accepted Node runtime and prove ordinary launch does not need pnpm; use pnpm only for the controlled Bundle installation/build step.
   - If using a native runtime artifact, verify platform/architecture and sidecars before spawn.
   - Run the same Loader/Profile smoke after packaging, not only from source.

## Decision outcome

The evidence and completed development-host smokes support the ADR 0002 decision:

- **Accepted released npm pair:** `@deepseek-ai/dsh@0.1.1-rc.2` with source tag `dsh-v0.1.1-rc.2`; it is immediately distributable and passed macOS/Windows development launch checks, but it lacks proven current-HEAD lifecycle contracts and still needs the native Bundle, Windows graceful-stop, manifest, and packaging checks.
- **Deferred pinned-source artifact:** build the official `dsh-v0.1.2-alpha.1` tree at `cd5ef814…` without changes only if an executable check proves the accepted pair lacks a required public seam; DSH Work would then own artifact reproducibility, signing, and update packaging.
- **Deferred official native wheel:** reconsider when an exact official release provides the required macOS and Windows artifacts and passes the same compatibility matrix.

Accepting the baseline authorizes only work against that exact pair. Provenance enforcement, secret-safe readiness, Windows graceful stop, clean-Profile Bundle load, and packaged macOS/Windows smokes remain implementation gates. Failure of a required public seam returns the work to Research and a superseding ADR; it does not authorize a Harness patch or parallel implementation.
