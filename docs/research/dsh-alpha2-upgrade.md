# Official dsh `0.1.2-alpha.2` upgrade research

Date: 2026-08-31

Status: PARTIAL — release/source/package inspection complete; this research does not execute the runtime or certify native platforms.

## Conclusion and scope

The released `0.1.2-alpha.2` pair is a candidate for the next Electron lifecycle slice because it exposes launcher-committed `appReady` and the public `exitOnStdinEnd` helper. Keep the official `dsh --profile` child-process boundary and compose a product-owned external Bundle. Do not embed `dsh-app-boot`, modify Harness, or reproduce its disposal controller. [Public lifecycle source](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/boot/cmdline/src/index.ts), [launcher source](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/apps/cli/src/profile-boot.ts).

This note records source facts and a proposed verification path, not acceptance of the candidate or completion of M0. The existing [ADR 0002](../decisions/0002-official-dsh-cli-runtime.md) records the historical `0.1.1-rc.2` decision. Historical macOS/Windows smoke results must remain associated with that old pair.

## Exact provenance

| Field | Candidate |
| --- | --- |
| Official repository | `https://github.com/deepseek-ai/deepseek-harness` |
| Tag | `dsh-v0.1.2-alpha.2` |
| Tag target | `0a53fb55bea101816fa226bb964ae2bed71c343b` |
| npm package | `@deepseek-ai/dsh@0.1.2-alpha.2` |
| npm integrity | `sha512-4TvTC5kRKlgtSU2UTBv+cID9a2Z+6+m6mpvjXWJfVzuTkflCff6s4MsQpFJTCmwFh/k7zNWe7qFXcLYMV/5VvA==` |
| npm tarball | `https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.1.2-alpha.2.tgz` |
| CLI entry | `dsh` → `lib/bin.js` |
| Release status | prerelease, published `2026-08-30T13:52:14Z` |
| Node policy | retain DSH Work's separately selected `24.11.1`; validate this exact runtime |

The tag API and registry metadata were read independently on the research date. The CLI package has no `engines` declaration; this is not proof that any Node version works. The release notes specifically report a startup/HMR fix affecting Node `24.0–24.11.1`, making a new smoke on the selected Node important. [Tag API](https://api.github.com/repos/deepseek-ai/deepseek-harness/git/ref/tags/dsh-v0.1.2-alpha.2), [npm version metadata](https://registry.npmjs.org/@deepseek-ai/dsh/0.1.2-alpha.2), [release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.2).

Read-only reproduction:

```sh
gh api repos/deepseek-ai/deepseek-harness/git/ref/tags/dsh-v0.1.2-alpha.2
npm view @deepseek-ai/dsh@0.1.2-alpha.2 version dist.integrity dist.tarball bin engines --json
```

The local installed CLI manifest declares 61 direct `@deepseek-ai/dsh*` dependencies, all with the range `^0.1.2-alpha.2`. A read-only inspection of its installed `node_modules/@deepseek-ai` found 214 DSH-family package manifests, all `0.1.2-alpha.2` and declaring MIT. These counts describe one local installation, not the complete transitive inventory or a reproducible package lock. Pin the dependency closure in the project; an exact top-level version alone does not freeze its range-based dependencies. [Released CLI manifest](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/apps/cli/package.json).

The separate candidate probe's fresh [lockfile](../../prototypes/m0-runtime-upgrade/pnpm-lock.yaml) records `react-dom@19.2.8(react@18.3.1)`, although that React DOM version declares `react: ^19.2.8`. Treat this as an unresolved dependency/UI compatibility risk. A successful headless lifecycle probe cannot resolve the warning or establish a working rendered interface; do not silently override the upstream dependency family to suppress it.

## Changes relevant to the product boundary

| Boundary | `0.1.1-rc.2` | `0.1.2-alpha.2` | DSH Work consequence |
| --- | --- | --- | --- |
| Exit service | `appExit` already exists | `appExit` remains public | Do not describe it as newly introduced. |
| Disposal bound | bounded shutdown already exists | 5,000 ms bound remains | Exit code zero alone does not prove graceful disposal. |
| Startup commitment | no `appReady` in cmdline contract | launcher provides `appReady.onReady` | Emit Ready only after this callback and product-specific checks. |
| stdin closure | no exported `exitOnStdinEnd` helper | helper gates EOF-triggered exit on Ready | Use the official helper; transport must actually consume/resume stdin. |
| Profile patches | launcher watches patches unconditionally | `patchReload: startup` or `live` | Pin `startup` for deterministic product lifecycle tests. |
| Browser entry | no process-token authentication in the inspected connection package | process token exchanges for a signed browser cookie | Replace bare-root HTTP-200 assumptions; never print authentication URLs. |

The old cmdline contract and launcher both already contain the exit service and shutdown wiring. Earlier wording that groups `appExit` or bounded shutdown with unavailable HEAD-only APIs should be read narrowly and corrected in the superseding decision. [Old cmdline source](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/packages/boot/cmdline/src/index.ts), [old launcher](https://github.com/deepseek-ai/deepseek-harness/blob/b150a551b8d465e31e418e1b2eaf5e79bbb7d28e/apps/cli/src/profile-boot.ts), [new shutdown controller](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/apps/cli/src/process-shutdown.ts).

`appReady` commits after boot and the selected patch-watcher setup succeed, while the root remains active and the signal-shutdown controller has not aborted. `exitOnStdinEnd` waits for that commitment, so EOF during failed startup must not turn the startup outcome into success. It intentionally does not call `stdin.resume()` or own a protocol parser. These are implementation facts checked against both released JavaScript and the exact tagged TypeScript; they still need integration regression tests. [Cmdline helper](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/boot/cmdline/src/index.ts), [launcher readiness](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/apps/cli/src/profile-boot.ts).

## External Profile and Bundle composition

The public profile resolver reads `$DSH_HOME/profiles/<name>/package.json`, resolves Bundle names from the CLI installation before the profile directory, and composes Bundle patches in declared order before user/launcher layers. Ordinary Node launches maintain installation-owned fallback links under the isolated home; this is runtime state, not permission to alter the installed package or source. A custom Bundle must declare `dsh.bundle.patch`; the full external plugin dependency closure must already be materialized. [Profile source and manifest types](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/boot/app-boot/src/profile.ts).

Proposed product Profile shape, with packages installed during controlled staging, not launch:

```json
{
  "name": "dsh-work-profile",
  "private": true,
  "type": "module",
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@dsh-work/lifecycle"
      ],
      "patchReload": "startup"
    }
  }
}
```

The illustrative `@dsh-work/lifecycle` package is product-owned, not an upstream package. It can be both Bundle and plugin: its manifest names its JavaScript entry and declares `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`; its patch inserts one uniquely identified lifecycle plugin. The plugin uses `ctx.appReady`, the public EOF helper, and Harness-owned disposal. Do not call `provideCmdline` from the product: the official launcher already provides these services.

For a lifecycle-only compatibility check, a smaller Profile containing only the external Bundle can establish the host-service seams without loading Agent or browser features. This does not prove the full base/web composition. For the actual browser composition, the external patch can override `web-runtime` with `openBrowser: false`, `printUrl: false`, `surfaceContext: true`, and `trustedHosts: []`. An id-targeted config patch replaces the row's whole config, so restate the keys deliberately. Keep the webserver at loopback and an ephemeral port. [Official web Bundle](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/bundle/web-app/cordis.patch.yml).

Example status: `NOT_RUN` in this research. The actual executable fixture must define its entry, staged dependencies, isolated home, stream lifecycle, and assertions before it can serve as evidence.

## Authentication, privacy, and stop evidence

The new browser authentication owner creates a process launch token and persists its cookie-signing secret through the Harness credential provider. Valid root token exchange returns HTTP `303` with `Location: /`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, and an authority-bound signed browser cookie. This is not HTTP `302`; test the actual released status. Host/Origin checks remain a distinct gate rather than a substitute for authentication. The web Bundle prints an authenticated URL when `printUrl` is enabled. [Browser authentication](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/client/connection/src/browser-auth.ts), [web runtime](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/bundle/web-app/src/index.ts).

Proposed product handling: obtain browser navigation through the public Connection service, retain the sensitive URL only in a private child-to-main channel, and expose neither token nor cookie through status events, ordinary stdout/stderr diagnostics, screenshots, or committed test artifacts. An unauthenticated response is a negative-path assertion, not proof of a broken server. Do not bypass or reimplement Harness authentication to recover the old HTTP-200 smoke.

The public method is `ctx.connection.authenticatedUrl(baseUrl: string): string`. `ctx.webServer.host` and `ctx.webServer.port` expose the bound endpoint, including the OS-selected port for `port: 0`. An injected lifecycle plugin can call the method after Ready without reading internal token state. Keep public status separate from the private navigation payload. [Connection interface](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/client/connection/src/rpc.ts), [webserver service](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/host/webserver/src/index.ts).

Set `DSH_TELEMETRY_DISABLED=1` in isolated compatibility tests. The released launcher treats any nonempty value as opt-out and disables the telemetry row if present; this does not establish a general network sandbox or prove every plugin is offline. Use an isolated `DSH_HOME` and omit provider credentials. [Telemetry switch implementation](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/apps/cli/src/profile-boot.ts).

Windows EOF is a candidate child-visible stop carrier, not a Windows test result. Require evidence that the child observed it, the product plugin disposed, the process exited within its bound, and owned descendants/ports were released. Since the upstream timeout can force exit with the requested code, `exit(0)` is insufficient by itself. A plugin disposal marker proves that plugin's cleanup only, not cleanup of every Harness child or service. Keep forced cleanup and graceful stop as distinct outcomes. [Shutdown implementation](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/apps/cli/src/process-shutdown.ts).

## Acceptance sequence and unresolved gates

1. Verify exact source artifact provenance/cleanliness and the locked runtime family before and after tests; record actual installed package versions rather than matching ADR text alone.
2. Make the lifecycle fixture fail against rc.2 for missing Ready/EOF capability; validate alpha.2 on standalone Node `24.11.1`, without modifying either upstream package.
3. Test one activation, Ready once, EOF stop, disposal, restart, startup failure with early EOF, invalid Profile, timeout, and nonzero exit. Add sensitive-output assertions.
4. Run the real base/web Profile separately, including authenticated entry and negative authentication paths.
5. Record candidate adoption in a superseding ADR, with source-pin, runtime-package, and product adaptations in separate commits. Preserve old evidence.
6. Complete Electron native macOS/Windows and packaged no-global-Node/no-package-manager checks before calling M0 complete.

This investigation executed only metadata requests and read-only source/package inspection. Runtime and desktop tests: `NOT_RUN`. Windows native and packaged matrix: `NOT_RUN`. Full dependency/license inventory, per-platform Node artifact hashes, source-to-published-tarball reproducible build equivalence, persistent-state migration/backward compatibility, Electron renderer security tests, and descendant cleanup remain unverified here. A clean-room candidate install does not demonstrate a safe in-place migration of a user's existing home.

Rollback should retain the prior immutable source/runtime/lock set and its separate test home. Do not point an older runtime at newly written credentials, sessions, or plugin state without a compatibility check and a recoverable backup. A failed public-seam test returns to official upstream research; it does not authorize a Harness patch.
