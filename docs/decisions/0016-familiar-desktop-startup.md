# 0016: Familiar desktop startup and local Harness compatibility

Status: accepted

Date: 2026-09-07

## Problem

DSH Work already starts a pinned Harness runtime through an external guardian and shows a bounded status surface before the authenticated Web client is ready. Existing Harness users, however, cannot see or deliberately reuse a compatible local profile, runtime failures expose only isolated recovery, and closing the only window always terminates active Agent work.

The product must remain familiar to DSH Desktop and DSH Web users without weakening the accepted runtime ownership boundary. In particular, a system-installed `dsh`, Node.js, or pnpm must never replace the product runtime, an existing profile must not be edited, and an uncertain Guardian generation must never be reused automatically.

Issue: [#24](https://github.com/zxheyi/dsh-work/issues/24).

## Evidence

- [`official-launcher.ts`](../../packages/runtime-host/official-launcher.ts) launches the accepted `@deepseek-ai/dsh` package with the managed Node executable and a scrubbed environment.
- [ADR 0004](0004-crash-safe-runtime-ownership.md) requires exclusive generation ownership and explicit isolated recovery.
- [ADR 0007](0007-authenticated-desktop-surface-handoff.md) limits renderer navigation to the authenticated loopback surface.
- The pinned `@deepseek-ai/dsh-app-boot` profile contract resolves profiles below `$DSH_HOME/profiles/<name>` and supports launcher-owned `--patch` overlays.
- The pinned base composition exposes explicit configuration paths for settings, credentials, session persistence, attachments, and storage. These remain Harness-owned services even when DSH Work selects their roots.
- DSH Desktop demonstrates that existing profiles can be discovered before Host boot, while a native tray can keep long-running work alive after the main window is hidden.

## Decision

Keep the accepted packaged Harness and Node pair as the only executable runtime. Local discovery reads the resolved `$DSH_HOME` or `~/.dsh`, admits only bounded regular profile directories whose bundle order contains `dsh-base` before `dsh-web-app`, and exposes only symbolic home labels plus bounded profile names to the status renderer.

An explicit first-run choice may reuse a compatible Harness data home. DSH Work creates a shadow profile inside its owned runtime generation, copies only the selected profile's declarative manifest and patch, and resolves third-party dependencies through links created inside that shadow. It never writes the source profile. A final launcher overlay mounts the DSH Work and lifecycle plugins and points the pinned Harness settings, credentials, sessions, attachments, and storage providers at the selected data home. DSH Work-owned workspaces, deliveries, and generation metadata remain below the product generation.

Because a shared Harness data home is mutable, the status surface must explain that the same profile should not run concurrently in another Harness process. Selection is explicit and persisted under Electron user data. Safe mode never opens shared data: it starts a fresh isolated generation with shipped defaults.

The status window remains the first visible surface. It owns local-profile selection, startup progress, compatibility failures, checkpoint recovery, and safe-mode entry. Raw filesystem paths, manifest bytes, patches, settings, credentials, session content, and authenticated URLs never cross its preload bridge.

After the Host reports Ready, the lifecycle bundle publishes only a bounded active-Agent boolean in addition to the existing lifecycle events. Closing the main window while an Agent is active hides it and leaves the Guardian running. A native tray can reveal the window, stop the runtime, enter safe mode after bounded shutdown, or quit. Closing an idle window retains the existing quit behavior.

Each healthy startup records a bounded checkpoint of the selected mode and declarative source-profile identity. It contains no credentials, settings values, session content, paths, or authenticated URL. Recovery can retry that admitted selection; safe mode discards it for the new generation.

## Acceptance and verification

- [ ] `tests/official-launcher.test.ts` proves inherited commands and sensitive environment values cannot replace the pinned runtime.
- [ ] Profile-discovery tests prove bounded admission, symbolic labels, deterministic ordering, and symlink/path refusal.
- [ ] Shadow-profile tests prove source bytes remain unchanged and only owned generation paths are written.
- [ ] Renderer and Electron tests prove the status surface precedes runtime start and persists an explicit first-run choice.
- [ ] Guardian tests prove healthy checkpoint publication, retry admission, and isolated safe mode.
- [ ] Lifecycle and close-policy tests prove active-Agent close hides without stopping while idle close quits.
- [ ] Tray tests and Electron smoke prove reveal, stop, safe-mode, and quit actions use the bounded Guardian lifecycle.
- [ ] `pnpm check`, `pnpm test`, affected runtime integration, and desktop E2E pass on the final revision.

## Alternatives considered

### Execute the locally installed DSH runtime

This would closely mirror a command-line installation but makes the product depend on unknown Node, package, plugin, and PATH state. It breaks the accepted runtime provenance and was rejected.

### Run the selected source profile in place

The official launcher writes a root config and may heal dependency fallbacks inside the selected profile. Running it directly therefore cannot guarantee a byte-clean source profile. The owned shadow keeps the public profile semantics without that mutation.

### Copy an existing Harness home into DSH Work

Copying private session, credential, attachment, and storage formats would create a second migration implementation and ambiguous ownership. The selected design points the original Harness providers at the user-approved roots instead.

### Always quit when the window closes

This is simple, but it terminates long-running Agent work on a common window-management action. The selected policy changes close behavior only while work is active and keeps explicit quit available.

## Consequences

Shared-profile mode intentionally permits Harness-owned writes to the selected settings, credential, session, attachment, and storage roots after the user chooses it. DSH Work does not coordinate with unrelated Harness processes, so concurrent use of the same data home remains unsupported and is disclosed before selection.

The Guardian protocol gains bounded selection, safe-mode, checkpoint, and activity fields. These are desktop lifecycle messages, not a parallel Agent or Session API. Profile format or provider-config changes in a future Harness pin require a dedicated compatibility review.

The tray adds a small platform-specific lifecycle surface and must remain usable without exposing Electron APIs to the renderer.

## Rollback or supersession

Remove shared-profile admission and ignore the persisted selection to return every launch to the isolated `dsh-work` profile. The shadow and checkpoint directories are product-owned and can remain inert. Keep safe mode and the tray close policy if their independent acceptance still passes.
