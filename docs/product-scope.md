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

## Current milestone

The current milestone is defined by [`acceptance/m0.md`](acceptance/m0.md). It proves the architecture and the smallest desktop lifecycle before broader work surfaces are built.

## In scope now

- Select and record the desktop technology stack through an accepted decision.
- Select and record the exact upstream source and runtime package strategy.
- Prove start, readiness, stop, abnormal-exit reporting, and recovery for a local Harness runtime.
- Prove one Harness-native Profile or Bundle composition without a parallel extension API.
- Establish automated contract, integration, and platform verification for the milestone.

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
