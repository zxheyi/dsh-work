# 0007: Authenticated desktop surface handoff

Status: implemented

Date: 2026-09-02

## Problem

The implemented Electron lifecycle window can start, stop, diagnose, and recover the official Harness runtime, while the DSH Work home already runs as a Harness Client plugin. The product still opens a developer-facing runtime status page instead of the real Work surface.

The official Web composition binds an operating-system-selected loopback port and issues a per-process launch-token URL. The desktop main process needs that one authenticated entry URL to load the existing Work Client. It must not parse stdout, persist the token, expose it through the renderer bridge, weaken the loopback boundary, or replace Harness browser authentication.

## Evidence

- `@deepseek-ai/dsh-web-app@0.1.2-alpha.2` derives the bound loopback URL from the public `webServer` service and calls `connection.authenticatedUrl()` after the Client Loader settles.
- `@deepseek-ai/dsh-client-connection@0.1.2-alpha.2` accepts the process launch token only on the root URL, mints an authority-bound cookie, and redirects to a clean `/` URL.
- ADR 0001 already assigns windowing and product presentation to DSH Work while preserving a sandboxed, context-isolated renderer.
- ADR 0004 already assigns runtime ownership to the external guardian and forbids URLs or tokens in renderer-visible snapshots and diagnostics.
- ADR 0006 implements the Work UI through official Harness Client slots, so loading the native Web composition does not add a second UI runtime.

## Decision

Add a one-way, in-memory desktop surface handoff beside the existing lifecycle status stream:

1. The DSH Work lifecycle Bundle uses the existing Harness `connection` and `webServer` services to produce the official authenticated loopback entry URL.
2. The child sends that URL over its existing product-owned lifecycle IPC channel. Runtime Host validates the exact shape before accepting it: `http`, hostname `127.0.0.1`, explicit non-zero port, root path, exactly one non-empty `token` query value, no credentials, and no fragment.
3. Runtime Host, Guardian Service, guardian IPC, and Guardian Client carry the validated value only through a separate surface callback. It is never added to `RuntimeSnapshot`, logs, diagnostics, files, command responses, or the preload bridge.
4. Electron main loads the authenticated URL into the existing product window. The page exchanges the token for Harness's signed cookie and redirects to a clean root URL. Navigation, popups, downloads, and permissions remain restricted to that exact loopback origin.
5. The local shell remains the boot, failure, and explicit recovery surface. Its preload bridge is installed only for the exact private `dsh-work://status/index.html` document. The Harness document receives no desktop lifecycle API.
6. DSH Work automatically starts the runtime after opening the local shell. Ready plus a validated surface handoff enters the Work home. Runtime failure returns to the local recovery shell.

The guardian continues to own process lifecycle and Profile generations. This decision changes no Workspace, Session, Agent, plugin, or browser-authentication owner.

## Acceptance and verification

- [x] Unit tests reject malformed, remote, credential-bearing, token-less, and extra-field surface messages.
- [x] Unit tests prove surface data is absent from lifecycle snapshots and renderer command responses.
- [x] Security tests prove the desktop bridge exists only on the private local shell and navigation is limited to its announced loopback origin.
- [x] An actual Electron test proves double-click launch automatically reaches the Work home without showing DSH Web, Workspace, Session, Profile, model, or plugin configuration.
- [x] Recovery E2E proves an abnormal runtime returns to the product recovery shell and an explicit recovery reaches a new Work surface.
- [x] A two-launch E2E creates one Work, closes cleanly, relaunches with the same product user-data directory, and observes the same Work.
- [x] Existing lifecycle, host-death, Loader, Work, and repository gates remain green.

The implementation evidence and exact commands are recorded in [`Desktop Work Shell`](../acceptance/desktop-work-shell.md).

## Alternatives considered

### Parse the printed URL from stdout

Rejected. Stdout is intentionally drained without retention, and human-readable output is not a stable or typed product interface. Parsing it would also mix credentials into diagnostics-sensitive output handling.

### Add the URL to `RuntimeSnapshot` or the preload bridge

Rejected. The status snapshot is renderer-visible, routinely asserted and reported, and intentionally contains only bounded lifecycle facts. A launch token is neither presentation state nor a renderer command.

### Load the clean loopback origin without a token

Rejected. It would bypass or fail Harness's supported launch-token exchange. DSH Work composes the existing browser authentication rather than weakening it.

### Open the operating-system browser

Rejected for the product shell. It would not make Electron the DSH Work desktop environment and would expose the technical DSH Web handoff instead of the Work product surface.

### Build a separate Electron renderer for Work

Rejected. The accepted Work UI is already a Harness Client plugin and must keep the single upstream Client, Remote, and plugin lifecycle.

## Consequences

- One sensitive value exists briefly in trusted child, guardian, and Electron-main memory. Every hop needs exact validation and non-logging tests.
- The same BrowserWindow changes between a private local shell and one trusted loopback origin; security checks must cover both documents.
- A runtime can be Ready before the Work surface has rendered. Desktop acceptance therefore waits for the Work Client's visible product markers, not only lifecycle Ready.
- Packaged signing and native Windows/macOS verification remain release gates under ADR 0001 and do not become complete through this development slice.

## Rollback or supersession

Rollback removes the surface event and automatic navigation while preserving the lifecycle and Work plugins. Supersede this decision if upstream exposes a dedicated Electron surface adapter that preserves the same token, renderer, and loopback boundaries with less product-owned transport.
