# DSH Work product scope

Status: active contract

## Product outcome

DSH Work gives people one desktop environment in which projects, files, web research, reviewable artifacts, and Agents can work together through DeepSeek Harness.

The product is a desktop distribution and composition layer. It is not a second Agent runtime or an alternative plugin ecosystem.

## Stable boundaries

| Layer | Responsibility |
| --- | --- |
| DeepSeek Harness | Agent runtime, sessions, models, tools, authorization, and plugin lifecycle |
| DSH Work Profile | Default Bundle and plugin composition for work-oriented use cases |
| Desktop host | Windowing, operating-system integration, process lifecycle, diagnostics, and recovery |
| Work surfaces | Project, file, research, and artifact experiences implemented through Harness client plugins |
| Ecosystem | Models, tools, Skills, MCP integrations, and workflows supplied by upstream or community plugins |

## Upstream-first invariant

DSH Work composes Harness; it does not modify, copy, or reimplement Harness-owned source and services.

- Pinned DeepSeek Harness source is a read-only, byte-clean compatibility baseline. Product features live outside that source tree.
- Product behavior uses Harness-native Profiles, Bundles, plugins, and public services.
- A verified capability gap returns to research and an upstream extension proposal before product implementation continues.
- A temporary runtime-package patch is an explicit compatibility exception, not a source fork. It requires the patch ledger, protection tests, upstream tracking, and a removal condition in [`upstream-compatibility.md`](upstream-compatibility.md).

## Current milestone

The active product milestone is [familiar DSH conversations and file outcomes](acceptance/familiar-work-v5.md), adopted by [ADR 0014](decisions/0014-familiar-conversations-and-versioned-files.md). The local implementation issue is [Familiar Work v5](implementation/familiar-v5.md). The existing [M0 lifecycle criteria](acceptance/m0.md) remain release gates; adopting the product milestone does not declare those gates complete.

## In scope now

- Preserve native Workspace, Session, model, mode, permission and settings navigation through the accepted alpha.2 public composition boundaries.
- Deliver ordinary conversations without a required Work goal or output-type form.
- Attach real files, review safe Markdown beside the conversation, revise in the original composer, and save independently of adoption.
- Add immutable file versions, comparison, restore and per-version adoption in independently verified slices.
- Keep existing lifecycle, authenticated surface handoff, plugin ownership and recovery guarantees while retaining old Work data.
- Treat full migration, native Save As, platform packaging and additional document formats as separately verified follow-on work.

## Explicit non-goals

- Reimplementing the Harness Agent Loop, session model, model layer, tool layer, or authorization system.
- Building a DSH Work-specific plugin protocol alongside Harness-native plugins.
- Shipping a broad plugin market, persistent multi-Agent team, memory system, scheduler, or automatic repair system before the first lifecycle is proven.
- Treating planned features in the README as implemented behavior.
- Accepting substantial external implementation contributions before a license and runnable verification gate exist.

## Scope change rule

A change to a stable boundary, current milestone, or explicit non-goal requires:

1. an Issue describing the user outcome and evidence;
2. an accepted decision under `docs/decisions/`;
3. updated acceptance criteria and verification;
4. a separate review from implementation details.
